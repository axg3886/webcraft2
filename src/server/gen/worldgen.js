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
const NUM_CHUNKS = 8;
const WORLD_SIZE = NUM_CHUNKS * CHUNK_SIZE;
const SEA_LEVEL = 50;

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
    stairs: undefined,
  });
};

const makeChunk = (i, j) => {
  const chunk = [];
  const heightMap = [];
  const get = (x, y, z) => chunk[y].get(x, z);
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

const nextTo = (world, x, y, z, v) => {
  if (x - 1 >= 0) {
    if (world.get(x - 1, y, z) === v) { // left
      return 1;
    }
  }
  if (z - 1 >= 0) {
    if (world.get(x, y, z - 1) === v) { // top
      return 2;
    }
  }
  if (x + 1 < WORLD_SIZE) {
    if (world.get(x + 1, y, z) === v) { // right
      return 3;
    }
  }
  if (z + 1 < WORLD_SIZE) {
    if (world.get(x, y, z + 1) === v) { // bottom
      return 4;
    }
  }
  if (x - 1 >= 0 && z - 1 >= 0) {
    if (world.get(x - 1, y, z - 1) === v) {
      return 5;
    }
  }
  if (x - 1 >= 0 && z + 1 < WORLD_SIZE) {
    if (world.get(x - 1, y, z + 1) === v) {
      return 6;
    }
  }
  if (x + 1 < WORLD_SIZE && z - 1 >= 0) {
    if (world.get(x + 1, z, z - 1) === v) {
      return 7;
    }
  }
  if (x + 1 < WORLD_SIZE && z + 1 < WORLD_SIZE) {
    if (world.get(x + 1, y, z + 1) === v) {
      return 8;
    }
  }
  return 0;
};

const ifWorks = (world, x, y, z, empty) =>
  !(x < 0 || x >= WORLD_SIZE || y < 0 || y >= CHUNK_HEIGHT || z < 0 || z >= WORLD_SIZE)
    && (empty ? world.get(x, y, z) === TYPES.stone : true);

const countNext = (world, x, y, z, c) => {
  let k = 0;
  if (x - 1 >= 0) {
    if (world.get(x - 1, y, z) === c) {
      k++;
    }
  }
  if (z - 1 >= 0) {
    if (world.get(x, y, z - 1) === c) {
      k++;
    }
  }
  if (x + 1 < CHUNK_SIZE) {
    if (world.get(x + 1, y, z) === c) {
      k++;
    }
  }
  if (z + 1 < CHUNK_SIZE) {
    if (world.get(x, y, z + 1) === c) {
      k++;
    }
  }
  return k;
};

const fillRect = (world, x, y, z, w, h, t) => {
  const m = w * h;
  let k = 0;
  let i;
  let j;
  for (i = 0; i < w; i++) {
    for (j = 0; j < h; j++) {
      if (ifWorks(world, x + i, y, z + j, true)) {
        k++;
      }
    }
  }
  if (k < m * (3 / 4)) {
    return false;
  }
  for (i = 0; i < w; i++) {
    for (j = 0; j < h; j++) {
      if (ifWorks(world, x + i, y, z + j, false)) {
        world.set(x + i, y, z + j, t);
      }
      if (ifWorks(world, x + i, y - 1, z + j, false)) {
        world.set(x + i, y - 1, z + j, t);
      }
    }
  }
  return true;
};

const genWalls = (world) => {
  let i;
  let j;
  let chunk;
  let x;
  let y;
  let z;

  for (i = 0; i < NUM_CHUNKS; i++) {
    for (j = 0; j < NUM_CHUNKS; j++) {
      chunk = world.getChunk(i, j);
      for (y = 0; y < CHUNK_HEIGHT; y++) {
        for (x = 0; x < CHUNK_SIZE; x++) {
          for (z = 0; z < CHUNK_SIZE; z++) {
            if ((
              nextTo(chunk, x, y, z, TYPES.air) !== 0 ||
                  nextTo(chunk, x, y, z, TYPES.stair) !== 0
            ) && (
                chunk.get(x, y, z) === TYPES.stone ||
                  chunk.get(x, y, z) === TYPES.dirt ||
                  chunk.get(x, y, z) === TYPES.grass)
            ) {
              chunk.set(x, y, z, TYPES.wall);
            }
          }
        }
      }
    }
  }
};

const nextInt = i => Math.floor(Math.random() * i);

const getRandomWall = (world, y, k) => {
  const x = nextInt(WORLD_SIZE);
  const z = nextInt(WORLD_SIZE);
  const q = nextTo(world, x, y, z, TYPES.air);
  if (world.get(x, y, z) === TYPES.wall && (q > 0 && q < 5)) {
    return { x, y, z };
  }
  return k < 200 ? getRandomWall(world, y, k + 1) : undefined;
};

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
  nextTo,
  ifWorks,
  countNext,
  fillRect,
  genWalls,
  getRandomWall,
  makeWorld,
  generateWorld,
  nextInt,
});
