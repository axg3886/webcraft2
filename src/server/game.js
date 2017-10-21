/*
  World Generation State Manager
  Copyright Ashwin Ganapathiraju, 2011-2017
  Written in Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const meshGen = require('./meshGen.js');
const worldGen = require('./gen/worldgen.js');
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
    }
  }
  // Update message
  latestGenData = returnObject();
};

const startSocketServer = (io) => {
  io.sockets.on('connection', (socket) => {
    let meshCount = 0;

    setInterval(() => {
      if (genState !== GEN_STATE.END) {
        socket.emit('genMsg', latestGenData);
      } else if (meshCount < builtMeshData.length) {
        const msg = makeMsg(meshCount, builtMeshData.length, GEN_STATE.SEND);
        socket.emit('genMsg', msg);
        socket.emit('meshData', {
          meshData: builtMeshData[meshCount],
          finished: meshCount === builtMeshData.length - 1,
        });
        meshCount++;
      }
    }, 20);
  });

  genState = GEN_STATE.START;

  setInterval(() => {
    if (genState !== GEN_STATE.END) {
      generateWorld();
    }
  }, 20);
};

module.exports.startSocketServer = startSocketServer;
