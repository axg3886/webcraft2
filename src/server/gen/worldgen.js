/*
  World Generator API
  Copyright Ashwin Ganapathiraju, 2011-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const perlinNoise = require('./noise.js');
const meshGen = require('../meshGen.js');

/* Type Data */
const TYPES = Object.freeze({
  air: 0,
  stone: 1,
  dirt: 2,
  grass: 3,
  wall: 4,
  iron: 5,
  gold: 6,
  water: 7,
  lava: 8,
  stair: 9,
  log: 10,
  leaf: 11,
  sand: 12,
});

const makeTypeArray = (init) => {
  const a = [];
  const keys = Object.keys(TYPES);
  for (let i = 0; i < keys.length; i++) {
    a[TYPES[keys[i]]] = init;
  }
  return a;
};

const TYPE_CUBE = makeTypeArray(true);
TYPE_CUBE[TYPES.air] = false;
TYPE_CUBE[TYPES.stair] = false;

const TYPE_OPAQUE = makeTypeArray(true);
TYPE_OPAQUE[TYPES.air] = false;
TYPE_OPAQUE[TYPES.water] = false;
TYPE_OPAQUE[TYPES.lava] = false;
TYPE_OPAQUE[TYPES.leaf] = false;

const TYPE_TEXTURES = makeTypeArray('');
TYPE_TEXTURES[TYPES.stair] = 'wood';

/** Public Accessor Data * */

const genTypes = [];

const CHUNK_SIZE = 16;
const CHUNK_HEIGHT = 128;
const WORLD_SIZE = 2 ** 31;
const SEA_LEVEL = 50;

perlinNoise.seed(Math.random() * 25);

/** Methods * */

const makeArr = () => {
  const arr = [];
  const N = CHUNK_SIZE; // Math.pow(2, p),
  const get = (x, z) => arr[(x * N) + z];
  const set = (x, z, v) => { arr[(x * N) + z] = v; };
  let x;
  let z;

  for (x = 0; x < N; x++) {
    for (z = 0; z < N; z++) {
      set(x, z, TYPES.stone);
    }
  }

  return Object.seal({
    get,
    set,
  });
};

const makeChunk = (i, j) => {
  let chunk = [];
  let mesh = undefined;
  const heightMap = [];
  const get = (x, y, z) => { if (chunk[y]) { return chunk[y].get(x, z); } return undefined; };
  const set = (x, y, z, v) => { chunk[y].set(x, z, v); };
  const globalX = x => (i << 4) + x;
  const globalZ = z => (j << 4) + z;
  const height = (x, z) => heightMap[(x * CHUNK_SIZE) + z];
  const setHeight = (x, z, v) => { heightMap[(x * CHUNK_SIZE) + z] = v; };
  const recalcHeight = () => {
    for (let n = 0; n < CHUNK_SIZE; n++) {
      for (let m = 0; m < CHUNK_SIZE; m++) {
        let s = false;
        for (let o = CHUNK_HEIGHT - 1; !s && o > -1; o--) {
          if (get(n, o, m) !== TYPES.air) {
            setHeight(n, m, o);
            s = true;
          }
        }
      }
    }
  };
  const read = (data) => { chunk = JSON.parse(data.data); };
  const write = () => JSON.stringify(chunk);
  const setMesh = (v) => { mesh = v; };
  const readMesh = (data) => { mesh = JSON.parse(data.mesh); };
  const writeMesh = () => JSON.stringify(mesh);

  for (let k = 0; k < CHUNK_HEIGHT; k++) {
    chunk[k] = makeArr();
  }

  return {
    get,
    set,
    globalX,
    globalZ,
    chunkX: i,
    chunkZ: j,
    height,
    recalcHeight,
    read,
    write,
    mesh,
    setMesh,
    readMesh,
    writeMesh,
  };
};

const generateChunk = (world, chunk) => {
  let x;
  let y;
  let z;
  let h;
  let t;

  for (y = 0; y < CHUNK_HEIGHT; y++) {
    for (x = 0; x < CHUNK_SIZE; x++) {
      for (z = 0; z < CHUNK_SIZE; z++) {
        h = Math.floor(
          (
            perlinNoise.octave( // X, Y, Z
              chunk.globalX(x) / (WORLD_SIZE), chunk.globalZ(z) / (WORLD_SIZE), 0,
              3, 1.1 // Octaves, Amplitude
            )
            + 0.6 // Raise the floor
          ) // Scale to height
          * CHUNK_HEIGHT * 2 / 3
        );
        chunk.setHeight(x, z, h);
        t = chunk.get(x, y, z);
        if (h < y) {
          chunk.set(x, y, z, (y < SEA_LEVEL) ? TYPES.water : TYPES.air);
        }
        if (h === y && t === TYPES.stone) {
          chunk.set(x, y, z, (y <= SEA_LEVEL) ? TYPES.sand : TYPES.grass);
        }
        if (h === y + 1 && t === TYPES.stone) {
          chunk.set(x, y, z, TYPES.dirt);
        }
      }
    }
  }
  for (let n = 0; n < genTypes.length; n++) {
    genTypes[n].generate(world, chunk.chunkX, chunk.chunkZ);
  }
  chunk.recalcHeight();

  const strings = [];
  for (let i = 0; i < 2; i++) {
    strings[i] = meshGen.generateChunkMesh(chunk, i);
  }
  chunk.setMesh(strings);
  return chunk;
};


const nextInt = i => Math.floor(Math.random() * i);

module.exports = Object.freeze({
  TYPES,
  TYPE_CUBE,
  TYPE_OPAQUE,
  TYPE_TEXTURES,
  genTypes,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  makeChunk,
  generateChunk,
  nextInt,
});
