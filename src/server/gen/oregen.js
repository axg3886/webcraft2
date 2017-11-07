/*
  Ore Generator
  Copyright Ashwin Ganapathiraju, 2014-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const worldGen = require('./worldgen.js');
const worldDefs = require('../../shared/worldDefs.js');

const ironOre = { maxVeins: 4.0, numBlocks: 24, maxY: 128, block: worldDefs.TYPES.iron };
const goldOre = { maxVeins: 0.4, numBlocks: 24, maxY: 32, block: worldDefs.TYPES.gold };

function genVein(world, x, y, z, numBlocks, block) {
  const angle = Math.random() * Math.PI;
  const xMin = x + 8 + Math.sin(angle) * numBlocks / 8.0;
  const xMax = x + 8 - Math.sin(angle) * numBlocks / 8.0;
  const zMin = z + 8 + Math.cos(angle) * numBlocks / 8.0;
  const zMax = z + 8 - Math.cos(angle) * numBlocks / 8.0;
  const yMin = y + worldGen.nextInt(3) - 2;
  const yMax = y + worldGen.nextInt(3) - 2;
  let iter;
  let xPos;
  let yPos;
  let zPos;
  let mod;
  let xBot;
  let yBot;
  let zBot;
  let xTop;
  let yTop;
  let zTop;
  let i;
  let xArc;
  let j;
  let yArc;
  let k;
  let zArc;
  let b;

  for (iter = 0; iter <= numBlocks; ++iter) {
    xPos = xMin + (xMax - xMin) * iter / numBlocks;
    yPos = yMin + (yMax - yMin) * iter / numBlocks;
    zPos = zMin + (zMax - zMin) * iter / numBlocks;
    mod = (Math.sin(iter * Math.PI / numBlocks) + 1.0) *
      (Math.random() * numBlocks / 16.0) + 1.0;
    xBot = Math.floor(xPos - mod / 2.0);
    xTop = Math.floor(xPos + mod / 2.0);
    yBot = Math.floor(yPos - mod / 2.0);
    yTop = Math.floor(yPos + mod / 2.0);
    zBot = Math.floor(zPos - mod / 2.0);
    zTop = Math.floor(zPos + mod / 2.0);

    for (i = xBot; i <= xTop; ++i) {
      xArc = (i + 0.5 - xPos) / (mod / 2.0);

      if (xArc * xArc < 1.0) {
        for (j = yBot; j <= yTop; ++j) {
          yArc = (j + 0.5 - yPos) / (mod / 2.0);

          if (xArc * xArc + yArc * yArc < 1.0) {
            for (k = zBot; k <= zTop; ++k) {
              zArc = (k + 0.5 - zPos) / (mod / 2.0);

              if (worldGen.ifWorks(world, i, j, k, false)) {
                b = world.get(i, j, k);
                if (xArc * xArc + yArc * yArc + zArc * zArc < 1.0) {
                  if (b === worldDefs.TYPES.stone) {
                    world.set(i, j, k, block);
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}

function genOre(world, i, j, ore) {
  let veins;
  let x;
  let y;
  let z;
  veins = ore.maxVeins;
  while (veins >= 1.0) {
    x = i * worldDefs.CHUNK_SIZE + worldGen.nextInt(worldDefs.CHUNK_SIZE);
    y = worldGen.nextInt(ore.maxY);
    z = j * worldDefs.CHUNK_SIZE + worldGen.nextInt(worldDefs.CHUNK_SIZE);
    genVein(world, x, y, z, ore.numBlocks, ore.block);
    veins--;
  }
  if (Math.random() < veins) {
    x = i * worldDefs.CHUNK_SIZE + worldGen.nextInt(worldDefs.CHUNK_SIZE);
    y = worldGen.nextInt(ore.maxY);
    z = j * worldDefs.CHUNK_SIZE + worldGen.nextInt(worldDefs.CHUNK_SIZE);
    genVein(world, x, y, z, ore.numBlocks, ore.block);
  }
}


function generate(world, i, j) {
  genOre(world, i, j, ironOre);
  genOre(world, i, j, goldOre);
  return world;
}

worldGen.genTypes[1] = Object.freeze({
  generate,
});
