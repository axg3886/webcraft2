/* globals window */ // If we're in the client....
/*
  World Generator API
  Copyright Ashwin Ganapathiraju, 2011-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/

const worldDefs = (function worldDefs() {
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

  /* Numeric Data */

  const CHUNK_SIZE = 16;
  const CHUNK_HEIGHT = 128;
  const NUM_CHUNKS = 6;
  const WORLD_SIZE = NUM_CHUNKS * CHUNK_SIZE;
  const SEA_LEVEL = 50;

  /* Methods */

  const makeArr = () => {
    const N = CHUNK_SIZE; // Math.pow(2, p),
    const arr = new Uint8ClampedArray(N * N);
    const get = (x, z) => arr[(x * N) + z];
    const set = (x, z, v) => { arr[(x * N) + z] = v; };
    const write = () => arr;
    const read = (data) => {
      for (let x = 0; x < N; x++) {
        for (let z = 0; z < N; z++) {
          set(x, z, data[(x * N) + z]);
        }
      }
    };
    for (let x = 0; x < N; x++) {
      for (let z = 0; z < N; z++) {
        set(x, z, TYPES.stone);
      }
    }

    return Object.seal({
      get,
      set,
      write,
      read,
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
    const write = () => {
      const obj = [];
      for (let k = 0; k < CHUNK_HEIGHT; k++) {
        obj[k] = chunk[k].write();
      }
      return obj;
    };
    const read = (obj) => {
      for (let k = 0; k < CHUNK_HEIGHT; k++) {
        chunk[k].read(obj[k]);
      }
    };

    for (let k = 0; k < CHUNK_HEIGHT; k++) {
      chunk[k] = makeArr();
    }

    return Object.freeze({
      get,
      set,
      globalX,
      globalZ,
      chunkX: i,
      chunkZ: j,
      height,
      setHeight,
      recalcHeight,
      write,
      read,
    });
  };

  const makeWorld = () => {
    const world = [];
    const indexed = i => world[i];

    const getChunk = (i, j) => indexed((i * NUM_CHUNKS) + j);
    const setChunk = (i, j, v) => { world[(i * NUM_CHUNKS) + j] = v; };

    const chunk = (x, z, o) => {
      const c = getChunk(x >> 4, z >> 4);
      return c ? o(c) : undefined;
    };
    const loop = (func) => {
      for (let x = 0; x < NUM_CHUNKS; x++) {
        for (let z = 0; z < NUM_CHUNKS; z++) {
          func(x, z);
        }
      }
    };

    const get = (x, y, z) => chunk(x, z, c => c.get(x % 16, y, z % 16));
    const set = (x, y, z, v) => { chunk(x, z, c => c.set(x % 16, y, z % 16, v)); };
    const height = (x, z) => chunk(x, z, c => c.height(x % 16, z % 16));
    const recalcHeight = () => loop((i, j) => getChunk(i, j).recalcHeight());

    const write = () => {
      const obj = [];
      loop((i, j) => { obj[(i * NUM_CHUNKS) + j] = getChunk(i, j).write(); });
      return obj;
    };
    const read = (obj) => {
      loop((i, j) => getChunk(i, j).read(obj[(i * NUM_CHUNKS) + j]));
    };

    loop((i, j) => setChunk(i, j, makeChunk(i, j)));

    return Object.freeze({
      get,
      set,
      getChunk,
      setChunk,
      height,
      recalcHeight,
      length: world.length,
      indexed,
      write,
      read,
    });
  };

  const posCheck = (world, x, y, z) => {
    const floorX = Math.floor(x + 0.1); // Ew....
    const floorY = Math.floor(y + 0.1); // have to do this...
    const floorZ = Math.floor(z + 0.1); // Ugh.....
    return world.get(floorX, floorY, floorZ) || TYPES.air;
  };

  const correctPosition = (world, orig, prev) => {
    const pos = orig;

    let gravity = 0.4905;
    if (posCheck(world, pos.x, pos.y, pos.z) === TYPES.water) {
      gravity *= 0.5; // Fall slower in water
    }
    pos.destY -= gravity;

    if (TYPE_OPAQUE[posCheck(world, pos.x - 0.25, pos.y, pos.z)]) {
      if (TYPE_OPAQUE[posCheck(world, pos.x - 0.25, pos.y + 1, pos.z)]) {
        pos.x = prev.x;
        pos.destX = prev.destX;
      } else {
        pos.y += 0.5;
        pos.destY += 0.5;
      }
    }
    if (TYPE_OPAQUE[posCheck(world, pos.x + 0.25, pos.y, pos.z)]) {
      if (TYPE_OPAQUE[posCheck(world, pos.x + 0.25, pos.y + 1, pos.z)]) {
        pos.x = prev.x;
        pos.destX = prev.destX;
      } else {
        pos.y += 0.5;
        pos.destY += 0.5;
      }
    }
    if (TYPE_OPAQUE[posCheck(world, pos.x, pos.y, pos.z - 0.25)]) {
      if (TYPE_OPAQUE[posCheck(world, pos.x, pos.y + 1, pos.z - 0.25)]) {
        pos.z = prev.z;
        pos.destZ = prev.destZ;
      } else {
        pos.y += 0.25;
        pos.destY += 0.25;
      }
    }
    if (TYPE_OPAQUE[posCheck(world, pos.x, pos.y, pos.z + 0.25)]) {
      if (TYPE_OPAQUE[posCheck(world, pos.x, pos.y + 1, pos.z + 0.25)]) {
        pos.z = prev.z;
        pos.destZ = prev.destZ;
      } else {
        pos.y += 0.5;
        pos.destY += 0.5;
      }
    }

    if (TYPE_OPAQUE[posCheck(world, pos.x, pos.y - 0.25, pos.z)]) {
      pos.y = prev.y;
      pos.destY = prev.destY;
    }
    if (TYPE_OPAQUE[posCheck(world, pos.x, pos.y + 0.25, pos.z)]) {
      pos.y = prev.y;
      pos.destY = prev.destY;
    }

    pos.x = Math.max(1, Math.min(WORLD_SIZE - 1, pos.x));
    pos.y = Math.max(-2, Math.min(CHUNK_HEIGHT, pos.y));
    pos.z = Math.max(1, Math.min(WORLD_SIZE - 1, pos.z));
    pos.destX = Math.max(1, Math.min(WORLD_SIZE - 1, pos.destX));
    pos.destY = Math.max(-2, Math.min(CHUNK_HEIGHT, pos.destY));
    pos.destZ = Math.max(1, Math.min(WORLD_SIZE - 1, pos.destZ));

    return pos;
  };

  return {
    // Data
    TYPES,
    TYPE_CUBE,
    TYPE_OPAQUE,
    TYPE_TEXTURES,
    CHUNK_HEIGHT,
    CHUNK_SIZE,
    NUM_CHUNKS,
    WORLD_SIZE,
    SEA_LEVEL,
    // Methods
    makeWorld,
    correctPosition,
  };
}());

if (typeof (module) !== 'undefined' && module.exports) {
  module.exports = worldDefs;
} else if (typeof (window) !== 'undefined') {
  window.app.worldDefs = worldDefs;
}
