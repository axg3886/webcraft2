/*
  World Generator API
  Copyright Ashwin Ganapathiraju, 2011-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const perlinNoise = require('./noise.js');

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
const NUM_CHUNKS = 6;
const WORLD_SIZE = NUM_CHUNKS * CHUNK_SIZE;
const SEA_LEVEL = 50;

/** Methods * */

const makeArr = () => {
  const N = CHUNK_SIZE; // Math.pow(2, p),
  const arr = new Uint8ClampedArray(N * N);
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
    stairs: undefined,
  });
};

const makeChunk = (i, j) => {
  const chunk = [];
  const heightMap = new Uint8ClampedArray(CHUNK_SIZE * CHUNK_SIZE);
  const get = (x, y, z) => { if (chunk[y]) { return chunk[y].get(x, z); } return undefined; };
  const set = (x, y, z, v) => { chunk[y].set(x, z, v); };
  const globalX = x => (i << 4) + x;
  const globalZ = z => (j << 4) + z;
  const height = (x, z) => heightMap[(x * CHUNK_SIZE) + z];
  const recalcHeight = () => {
    for (let n = 0; n < CHUNK_SIZE; n++) {
      for (let m = 0; m < CHUNK_SIZE; m++) {
        let s = false;
        for (let o = CHUNK_HEIGHT - 1; !s && o > -1; o--) {
          if (get(n, o, m) !== TYPES.air) {
            heightMap[(n * CHUNK_SIZE) + m] = o;
            s = true;
          }
        }
      }
    }
  };
  let k;
  let x;
  let z;

  for (k = 0; k < CHUNK_HEIGHT; k++) {
    chunk[k] = makeArr();
  }

  for (x = 0; x < CHUNK_SIZE; x++) {
    for (z = 0; z < CHUNK_SIZE; z++) {
      heightMap[(x * CHUNK_SIZE) + z] = Math.floor(
        (
          perlinNoise.octave( // X, Y, Z
            globalX(x) / (WORLD_SIZE), globalZ(z) / (WORLD_SIZE), 0,
            3, 1.1 // Octaves, Amplitude
          )
          + 0.6 // Raise the floor
        ) // Scale to height
        * CHUNK_HEIGHT * 2 / 3
      );
    }
  }

  return Object.freeze({
    get,
    set,
    globalX,
    globalZ,
    chunkX: i,
    chunkZ: j,
    height,
    recalcHeight,
  });
};

const makeWorld = () => {
  const world = [];
  const indexed = i => world[i];
  const getChunk = (i, j) => indexed((i * NUM_CHUNKS) + j);
  const setChunk = (i, j, v) => { world[(i * NUM_CHUNKS) + j] = v; };
  const chunk = (x, z, o) => { const c = getChunk(x >> 4, z >> 4); return c ? o(c) : undefined; };
  const get = (x, y, z) => chunk(x, z, c => c.get(x % 16, y, z % 16));
  const set = (x, y, z, v) => { chunk(x, z, c => c.set(x % 16, y, z % 16, v)); };
  const height = (x, z) => chunk(x, z, c => c.height(x % 16, z % 16));
  const recalcHeight = () => {
    for (let x = 0; x < NUM_CHUNKS; x++) {
      for (let z = 0; z < NUM_CHUNKS; z++) {
        getChunk(x, z).recalcHeight();
      }
    }
  };
  let i;
  let j;

  perlinNoise.seed(Math.random() * 25);

  for (i = 0; i < NUM_CHUNKS; i++) {
    for (j = 0; j < NUM_CHUNKS; j++) {
      setChunk(i, j, makeChunk(i, j));
    }
  }

  return Object.freeze({
    get,
    set,
    getChunk,
    setChunk,
    height,
    recalcHeight,
    length: world.length,
    indexed,
  });
};

const ifWorks = (world, x, y, z, empty) =>
  !(x < 0 || x >= WORLD_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= WORLD_SIZE)
    && (empty ? world.get(x, y, z) === TYPES.stone : true);

const nextInt = i => Math.floor(Math.random() * i);

const generateWorld = (world) => {
  let i;
  let j;
  let chunk;
  let x;
  let y;
  let z;
  let h;
  let t;

  for (i = 0; i < NUM_CHUNKS; i++) {
    for (j = 0; j < NUM_CHUNKS; j++) {
      chunk = world.getChunk(i, j);

      for (y = 0; y < CHUNK_HEIGHT; y++) {
        for (x = 0; x < CHUNK_SIZE; x++) {
          for (z = 0; z < CHUNK_SIZE; z++) {
            h = chunk.height(x, z);
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
    }
  }
  return world;
};

module.exports = Object.freeze({
  TYPES,
  TYPE_CUBE,
  TYPE_OPAQUE,
  TYPE_TEXTURES,
  genTypes,
  CHUNK_HEIGHT,
  CHUNK_SIZE,
  NUM_CHUNKS,
  WORLD_SIZE,
  ifWorks,
  makeWorld,
  generateWorld,
  nextInt,
});
