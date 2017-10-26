/*
  World Generation State Manager
  Copyright Ashwin Ganapathiraju, 2011-2017
  Written in Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const meshGen = require('./meshGen.js');
const worldGen = require('./gen/worldgen.js');
const xxh = require('xxhashjs');
require('./gen/cavern.js');
require('./gen/oregen.js');
require('./gen/trees.js');

const GEN_STATE = Object.freeze({
  START: 'Preparing Resources',
  WORLD: 'Generating World',
  MESH: 'Building Meshes',
  END: 'Finishing up...',
  SEND: 'Sending Data...',
});

let genAmount = 0;
let genMax = 50;
let genState = undefined;
let world = {};

// Global entity counter
let entityId = 1;
// Global entity list (id -> entity)
const entityList = {};

const makeMsg = (amt, max, msg) => {
  let genStr = '';
  let genPercent = amt / max;
  for (let k = 0; k < 1; k += 0.1) {
    genStr += (genPercent > k) ? '|' : ' ';
  }
  genPercent = (genPercent * 100).toFixed(2);
  return {
    genMessage: msg,
    genStr,
    genPercent,
  };
};

const returnObject = () => makeMsg(genAmount, genMax, genState);

let latestGenData;
const builtMeshData = [];

const generateWorld = () => {
  if (genState === GEN_STATE.START) {
    console.log(genState);
    genState = GEN_STATE.WORLD;
    genAmount = 0;
    genMax = worldGen.CHUNK_SIZE + 1;
  } else if (genState === GEN_STATE.WORLD) {
    if (genAmount === 0) {
      world = worldGen.makeWorld();
      world = worldGen.generateWorld(world);
      genAmount++;
      console.log(genState);
    } else if (genAmount < genMax - 1) {
      for (let n = 0; n < worldGen.genTypes.length; n++) {
        const generator = worldGen.genTypes[n];
        for (let i = 0; i < worldGen.NUM_CHUNKS; i++) {
          for (let j = 0; j < worldGen.NUM_CHUNKS; j++) {
            generator.generate(world, i, j);
          }
        }
      }
      genAmount++;
    } else {
      world.recalcHeight();
      genAmount = 0;
      genMax = world.length;
      genState = GEN_STATE.MESH;
      console.log(genState);
    }
  } else if (genState === GEN_STATE.MESH) {
    if (genAmount < genMax) {
      const chunk = world.indexed(genAmount);
      const strings = [];
      for (let i = 0; i < 2; i++) {
        strings[i] = meshGen.generateChunkMesh(chunk, i);
      }
      builtMeshData.push({
        str: strings,
        chunkIndex: genAmount,
        chunkX: chunk.globalX(0),
        chunkZ: chunk.globalZ(0),
      });
      genAmount++;
    }
    if (genAmount >= genMax) {
      genState = GEN_STATE.END;
      console.log(genState);
      world.recalcHeight();
    }
  }
  // Update message
  latestGenData = returnObject();
};

const makeEntity = (name) => {
  const centerX = worldGen.WORLD_SIZE / 2 + worldGen.nextInt(6) - 3;
  const centerZ = worldGen.WORLD_SIZE / 2 + worldGen.nextInt(6) - 3;
  const centerY = world.height(centerX, centerZ) + 3;
  const e = {
    name,
    id: xxh.h32(`${entityId++}${Date.now()}`, 0xCAFEBABE).toString(16),
    lastUpdate: new Date().getTime(),
    x: centerX,
    y: centerY,
    z: centerZ,
    prevX: centerX,
    prevY: centerY,
    prevZ: centerZ,
    destX: centerX,
    destY: centerY,
    destZ: centerZ,
    rotationP: -0.2,
    rotationT: 0,
    onGround: true,
  };
  return e;
};

const startSocketServer = (io) => {
  io.sockets.on('connection', (sock) => {
    const socket = sock;
    let meshCount = 0;

    // Spawn 'thread' to send client world data
    setInterval(() => {
      if (genState !== GEN_STATE.END) {
        socket.emit('genMsg', latestGenData);
      } else if (meshCount < builtMeshData.length) {
        const msg = makeMsg(meshCount, builtMeshData.length, GEN_STATE.SEND);
        socket.emit('genMsg', msg);
        socket.emit('meshData', {
          meshData: builtMeshData[meshCount],
          finished: meshCount === builtMeshData.length - 1,
          start: meshCount === 0,
        });
        meshCount++;
      }
    }, 20);

    socket.on('join', (data) => {
      // Create entity
      const player = makeEntity(data.name);
      socket.playerId = player.id;
      entityList[player.id] = player;

      player.selfUser = true;
      socket.emit('update', player);
      player.selfUser = false;
      socket.broadcast.emit('update', player);

      const keys = Object.keys(entityList);
      for (let i = 0; i < keys.length; i++) {
        socket.emit('update', entityList[keys[i]]);
      }
    });

    socket.on('disconnect', () => {
      const player = entityList[socket.playerId];
      if (player) {
        io.emit('kill', { id: player.id });
        delete entityList[player.id];
      }
    });

    // Handle entity movement
    socket.on('movement', (data) => {
      const player = entityList[socket.playerId];
      if (!player) {
        return;
      }

      // Height check
      const floorX = Math.floor(data.x); const floorZ = Math.floor(data.z);
      const height = world.height(floorX, floorZ) + 3;
      const shiftY = Math.max(height, data.y);
      const block = world.get(floorX, Math.floor(shiftY - 3), floorZ);
      let gravity = 0.04905;
      if (block === worldGen.TYPES.water) {
        gravity *= 0.5; // Fall slower in water
      }

      player.x = data.x;
      player.y = shiftY - gravity;
      player.z = data.z;
      player.prevX = data.prevX;
      player.prevY = data.prevY;
      player.prevZ = data.prevZ;
      player.destX = data.destX;
      player.destY = data.destY;
      player.destZ = data.destZ;
      player.rotationP = data.rotationP;
      player.rotationT = data.rotationT;
      player.lastUpdate = new Date().getTime();
      player.onGround = block !== worldGen.TYPES.air;
      player.height = height;
      if (player.y !== data.y) {
        io.emit('update', player);
      } else {
        socket.broadcast.emit('update', player);
      }
    });
  });

  genState = GEN_STATE.START;

  let worldTime = 0;
  let lastTime = new Date().getTime();
  // Spawn main generation 'thread'
  setInterval(() => {
    if (genState !== GEN_STATE.END) {
      generateWorld();
    } else {
      const currentTime = new Date().getTime();
      worldTime += (currentTime - lastTime); // Delta Time
      lastTime = currentTime;
      io.emit('timeUpdate', { time: worldTime }); // Time update
    }
  }, 20);
};

module.exports.startSocketServer = startSocketServer;
