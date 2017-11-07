/*
  World Generator API
  Copyright Ashwin Ganapathiraju, 2011-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const perlinNoise = require('./noise.js');
const worldDefs = require('../../shared/worldDefs.js');

const genTypes = [];

const ifWorks = (world, x, y, z, empty) =>
  !(
    x < 0 || x >= worldDefs.WORLD_SIZE ||
    y < 0 || y >= worldDefs.CHUNK_HEIGHT ||
    z < 0 || z >= worldDefs.WORLD_SIZE
  ) && (empty ? world.get(x, y, z) === worldDefs.TYPES.stone : true);

const nextInt = i => Math.floor(Math.random() * i);

const generateWorld = (world) => {
  perlinNoise.seed(Math.random() * 25);

  for (let i = 0; i < worldDefs.NUM_CHUNKS; i++) {
    for (let j = 0; j < worldDefs.NUM_CHUNKS; j++) {
      const chunk = world.getChunk(i, j);

      for (let y = 0; y < worldDefs.CHUNK_HEIGHT; y++) {
        for (let x = 0; x < worldDefs.CHUNK_SIZE; x++) {
          for (let z = 0; z < worldDefs.CHUNK_SIZE; z++) {
            const h = Math.floor(
              (
                perlinNoise.octave(
                  chunk.globalX(x) / (worldDefs.WORLD_SIZE), // X
                  chunk.globalZ(z) / (worldDefs.WORLD_SIZE), // Y
                  0, // Z
                  3, 1.1 // Octaves, Amplitude
                )
                + 0.6 // Raise the floor
              ) // Scale to height
              * worldDefs.CHUNK_HEIGHT * 2 / 3
            );
            chunk.setHeight(x, z, h);

            const t = chunk.get(x, y, z);
            if (h < y) {
              chunk.set(x, y, z,
                (y < worldDefs.SEA_LEVEL) ? worldDefs.TYPES.water : worldDefs.TYPES.air);
            }
            if (h === y && t === worldDefs.TYPES.stone) {
              chunk.set(x, y, z,
                (y <= worldDefs.SEA_LEVEL) ? worldDefs.TYPES.sand : worldDefs.TYPES.grass);
            }
            if (h === y + 1 && t === worldDefs.TYPES.stone) {
              chunk.set(x, y, z, worldDefs.TYPES.dirt);
            }
          }
        }
      }
    }
  }
  return world;
};

module.exports = Object.freeze({
  genTypes,
  ifWorks,
  generateWorld,
  nextInt,
});
