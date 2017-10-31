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

const makeFakeVector = (x, y, z) => {
  const e = {
    x,
    y,
    z,
    prevX: x,
    prevY: y,
    prevZ: z,
    destX: x,
    destY: y,
    destZ: z,
  };
  return e;
};

const makeEntity = (name) => {
  const centerX = worldGen.WORLD_SIZE / 2 + worldGen.nextInt(6) - 3;
  const centerZ = worldGen.WORLD_SIZE / 2 + worldGen.nextInt(6) - 3;
  const centerY = world.height(centerX, centerZ) + 3;
  const e = {
    name,
    id: xxh.h32(`${entityId++}${Date.now()}`, 0xCAFEBABE).toString(16),
    lastUpdate: new Date().getTime(),
    pos: makeFakeVector(centerX, centerY, centerZ),
    rot: makeFakeVector(-0.2, 0, 0),
    onGround: false,
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
        console.log(`Disconnected: ${player.id}`);
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
      const pos = data.pos;

      const posCheck = (x, y, z) => {
        const floorX = Math.floor(x);
        const floorY = Math.floor(y);
        const floorZ = Math.floor(z);
        return world.get(floorX, floorY, floorZ) || worldGen.TYPES.air;
      };

      let gravity = 0.4905;
      if (posCheck(pos.x, pos.y, pos.z) === worldGen.TYPES.water) {
        gravity *= 0.5; // Fall slower in water
      }
      pos.destY -= gravity;

      if (worldGen.TYPE_OPAQUE[posCheck(pos.x - 0.25, pos.y, pos.z)]) {
        if (worldGen.TYPE_OPAQUE[posCheck(pos.x - 0.25, pos.y + 1, pos.z)]) {
          pos.x = player.pos.x;
          pos.destX = player.pos.destX;
        } else {
          pos.y += 0.5;
          pos.destY += 0.5;
        }
      }
      if (worldGen.TYPE_OPAQUE[posCheck(pos.x + 0.25, pos.y, pos.z)]) {
        if (worldGen.TYPE_OPAQUE[posCheck(pos.x + 0.25, pos.y + 1, pos.z)]) {
          pos.x = player.pos.x;
          pos.destX = player.pos.destX;
        } else {
          pos.y += 0.5;
          pos.destY += 0.5;
        }
      }
      if (worldGen.TYPE_OPAQUE[posCheck(pos.x, pos.y, pos.z - 0.25)]) {
        if (worldGen.TYPE_OPAQUE[posCheck(pos.x, pos.y + 1, pos.z - 0.25)]) {
          pos.z = player.pos.z;
          pos.destZ = player.pos.destZ;
        } else {
          pos.y += 0.25;
          pos.destY += 0.25;
        }
      }
      if (worldGen.TYPE_OPAQUE[posCheck(pos.x, pos.y, pos.z + 0.25)]) {
        if (worldGen.TYPE_OPAQUE[posCheck(pos.x, pos.y + 1, pos.z + 0.25)]) {
          pos.z = player.pos.z;
          pos.destZ = player.pos.destZ;
        } else {
          pos.y += 0.5;
          pos.destY += 0.5;
        }
      }

      if (worldGen.TYPE_OPAQUE[posCheck(pos.x, pos.y - 0.25, pos.z)]) {
        pos.y = player.pos.y;
        pos.destY = player.pos.destY;
      }
      if (worldGen.TYPE_OPAQUE[posCheck(pos.x, pos.y + 0.25, pos.z)]) {
        pos.y = player.pos.y;
        pos.destY = player.pos.destY;
      }

      pos.x = Math.max(1, Math.min(worldGen.WORLD_SIZE - 1, pos.x));
      pos.y = Math.max(-2, Math.min(worldGen.CHUNK_HEIGHT, pos.y));
      pos.z = Math.max(1, Math.min(worldGen.WORLD_SIZE - 1, pos.z));
      pos.destX = Math.max(1, Math.min(worldGen.WORLD_SIZE - 1, pos.destX));
      pos.destY = Math.max(-2, Math.min(worldGen.CHUNK_HEIGHT, pos.destY));
      pos.destZ = Math.max(1, Math.min(worldGen.WORLD_SIZE - 1, pos.destZ));

      player.onGround = pos.y === player.pos.y || pos.y <= 0;
      player.pos = pos;
      player.rot = data.rot;
      player.lastUpdate = new Date().getTime();
      setInterval(() => io.emit('update', player), 5000);
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
