/*
  Tree Generator
  Copyright Ashwin Ganapathiraju, 2014-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const worldGen = require('./worldgen.js');
const worldDefs = require('../../shared/worldDefs.js');

const genTree = (world, x, y, z) => {
  const height = worldGen.nextInt(8) + 4;
  const upper = y + height + 1;

  if (y >= 1 && upper < worldDefs.CHUNK_HEIGHT) {
    for (let j = 0; j < height; ++j) {
      if (!worldGen.ifWorks(world, x, y + j, z, false) ||
          world.get(x, y + j, z) !== worldDefs.TYPES.air) {
        return;
      }
    }

    const below = world.get(x, y - 1, z);

    if ((below === worldDefs.TYPES.dirt || below === worldDefs.TYPES.grass)
        && y < worldDefs.CHUNK_HEIGHT - height - 1) {
      world.set(x, y - 1, z, worldDefs.TYPES.dirt);

      for (let j = (y - 3) + height; j < upper; ++j) {
        const n = j - (y + height);
        const width = 1 - Math.floor(n / 2);
        for (let i = x - width; i <= x + width; ++i) {
          for (let k = z - width; k <= z + width; ++k) {
            if (worldGen.ifWorks(world, i, j, k, false)) {
              if (Math.abs(i - x) !== width || Math.abs(k - z) !== width) {
                if (world.get(i, j, k) === worldDefs.TYPES.air) {
                  world.set(i, j, k, worldDefs.TYPES.leaf);
                }
              }
            }
          }
        }
      }
      for (let j = 0; j < height; ++j) {
        world.set(x, y + j, z, worldDefs.TYPES.log);
      }
    }
  }
};

const generate = (world, i, j) => {
  for (let k = 0; k < 20; k++) {
    const x = (i * worldDefs.CHUNK_SIZE) + worldGen.nextInt(worldDefs.CHUNK_SIZE);
    const z = (j * worldDefs.CHUNK_SIZE) + worldGen.nextInt(worldDefs.CHUNK_SIZE);
    const y = world.height(x, z);
    genTree(world, x, y, z);
  }
  return world;
};

worldGen.genTypes[2] = Object.freeze({
  generate,
});
