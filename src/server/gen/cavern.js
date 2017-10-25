/*
  Cavern Generator
  Copyright Ashwin Ganapathiraju, 2011-2017
  Exported to Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const worldGen = require('./worldgen.js');

function generateCaveNode(xCenter, zCenter, world, sX, sY, sZ, angleX, aY, aZ, v1, v2, var3) {
  const centerX = xCenter * worldGen.CHUNK_SIZE + 8;
  const centerZ = zCenter * worldGen.CHUNK_SIZE + 8;
  let angleVarY = 0.0;
  let angleVarZ = 0.0;
  let startX = sX;
  let startY = sY;
  let startZ = sZ;
  let angleY = aY;
  let angleZ = aZ;
  let var1 = v1;
  let var2 = v2;

  if (var2 <= 0) {
    const chunkRange = 8 * worldGen.CHUNK_SIZE - worldGen.CHUNK_SIZE;
    var2 = chunkRange - worldGen.nextInt(chunkRange / 4);
  }

  let breaker = false;

  if (var1 === -1) {
    var1 = var2 / 2;
    breaker = true;
  }

  const genMoreCaves = worldGen.nextInt(var2 / 2) + var2 / 4;

  for (let randTurn = worldGen.nextInt(6) === 0; var1 < var2; ++var1) {
    const modXY = 1.5 + Math.sin(var1 * Math.PI / var2) * angleX;
    const modXZ = modXY * var3;
    const cosZ = Math.cos(angleZ);
    const sinZ = Math.sin(angleZ);
    startX += Math.cos(angleY) * cosZ;
    startY += sinZ;
    startZ += Math.sin(angleY) * cosZ;

    if (randTurn) {
      angleZ *= 0.92;
    } else {
      angleZ *= 0.7;
    }

    angleZ += angleVarZ * 0.1;
    angleY += angleVarY * 0.1;
    angleVarZ *= 0.9;
    angleVarY *= 0.75;
    angleVarZ += (Math.random() - Math.random()) * Math.random() * 2.0;
    angleVarY += (Math.random() - Math.random()) * Math.random() * 4.0;

    if (!breaker && var1 === genMoreCaves && angleX > 1.0 && var2 > 0) {
      generateCaveNode(xCenter, zCenter, world,
        startX, startY, startZ,
        Math.random() * 0.5 + 0.5, angleY - (Math.PI / 2), angleZ / 3.0,
        var1, var2, 1.0);
      generateCaveNode(xCenter, zCenter, world,
        startX, startY, startZ,
        Math.random() * 0.5 + 0.5, angleY + (Math.PI / 2), angleZ / 3.0,
        var1, var2, 1.0);
      return;
    }

    if (!breaker && worldGen.nextInt(4) === 0) {
      continue;
    }
    const displaceX = startX - centerX;
    const displaceZ = startZ - centerZ;
    const d10 = var2 - var1;
    const scale = angleX + 2.0 + worldGen.CHUNK_SIZE;

    if (displaceX * displaceX + displaceZ * displaceZ - d10 * d10 > scale * scale) { return; }

    if (startX >= centerX - worldGen.CHUNK_SIZE - modXY * 2.0 &&
        startZ >= centerZ - worldGen.CHUNK_SIZE - modXY * 2.0 &&
        startX <= centerX + worldGen.CHUNK_SIZE + modXY * 2.0 &&
        startZ <= centerZ + worldGen.CHUNK_SIZE + modXY * 2.0) {
      let tminX = Math.floor(startX - modXY) - xCenter * worldGen.CHUNK_SIZE - 1;
      let tmaxX = Math.floor(startX + modXY) - xCenter * worldGen.CHUNK_SIZE + 1;
      let tminY = Math.floor(startY - modXZ) - 1;
      let tmaxY = Math.floor(startY + modXZ) + 1;
      let tminZ = Math.floor(startZ - modXY) - zCenter * worldGen.CHUNK_SIZE - 1;
      let tmaxZ = Math.floor(startZ + modXY) - zCenter * worldGen.CHUNK_SIZE + 1;

      if (tminX < 0) {
        tminX = 0;
      }

      if (tmaxX > worldGen.CHUNK_SIZE) {
        tmaxX = worldGen.CHUNK_SIZE;
      }

      if (tminY < 1) {
        tminY = 1;
      }

      if (tmaxY > worldGen.CHUNK_HEIGHT - 8) {
        tmaxY = worldGen.CHUNK_HEIGHT - 8;
      }

      if (tminZ < 0) {
        tminZ = 0;
      }

      if (tmaxZ > worldGen.CHUNK_SIZE) {
        tmaxZ = worldGen.CHUNK_SIZE;
      }

      let hitOcean = false;

      for (let localX = tminX; !hitOcean && localX < tmaxX; ++localX) {
        for (let localZ = tminZ; !hitOcean && localZ < tmaxZ; ++localZ) {
          for (let localY = tmaxY + 1; !hitOcean && localY >= tminY - 1; --localY) {
            const x = xCenter * worldGen.CHUNK_SIZE + localX;
            const z = zCenter * worldGen.CHUNK_SIZE + localZ;

            if (worldGen.ifWorks(world, x, localY, z, false)) {
              if (world.get(x, localY, z) === worldGen.TYPES.water) {
                hitOcean = true;
              }

              if (localY !== tminY - 1 && localX !== tminX && localX !== tmaxX - 1
                    && localZ !== tminZ && localZ !== tmaxZ - 1) {
                localY = tminY;
              }
            }
          }
        }
      }

      if (!hitOcean) {
        for (let localX = tminX; localX < tmaxX; ++localX) {
          const modX = (localX + xCenter * worldGen.CHUNK_SIZE + 0.5 - startX) / modXY;

          for (let localZ = tminZ; localZ < tmaxZ; ++localZ) {
            const modZ = (localZ + zCenter * worldGen.CHUNK_SIZE + 0.5 - startZ) / modXY;

            if (modX * modX + modZ * modZ < 1.0) {
              for (let localY = tmaxY - 1; localY >= tminY; --localY) {
                const realY = (localY + 0.5 - startY) / modXZ;
                const x = xCenter * worldGen.CHUNK_SIZE + localX;
                const z = zCenter * worldGen.CHUNK_SIZE + localZ;

                if (realY > -0.7 && modX * modX + realY * realY + modZ * modZ < 1.0
                      && worldGen.ifWorks(world, x, localY, z, false)) {
                  const block = world.get(x, localY, z);

                  if (block === worldGen.TYPES.stone ||
                      block === worldGen.TYPES.dirt ||
                      block === worldGen.TYPES.grass ||
                      block === worldGen.TYPES.iron ||
                      block === worldGen.TYPES.gold) {
                    world.set(x, localY, z,
                      (localY < 10) ? worldGen.TYPES.lava : worldGen.TYPES.air);
                  }
                }
              }
            }
          }

          if (breaker) {
            break;
          }
        }
      }
    }
  }
}

function generateLargeCaveNode(xCenter, zCenter, world, x, y, z) {
  generateCaveNode(xCenter, zCenter, world,
    x, y, z,
    1.0 + Math.random() * 6.0, 0.0, 0.0,
    -1, -1, 0.5);
}

function genCaves(world, xChunk, zChunk, xCenter, zCenter) {
  let numBigNodes = worldGen.nextInt(worldGen.nextInt(worldGen.nextInt(30) + 1) + 5);

  if (worldGen.nextInt(25) !== 0) {
    numBigNodes = 0;
  }
  for (let i = 0; i < numBigNodes; ++i) {
    const cX = xChunk * worldGen.CHUNK_SIZE + worldGen.nextInt(worldGen.CHUNK_SIZE);
    const cY = worldGen.nextInt(worldGen.CHUNK_HEIGHT - 8) + 8;
    const cZ = zChunk * worldGen.CHUNK_SIZE + worldGen.nextInt(worldGen.CHUNK_SIZE);
    let numSmallNodes = 1;

    if (worldGen.nextInt(4) === 0) {
      generateLargeCaveNode(xCenter, zCenter, world, cX, cY, cZ);
      numSmallNodes += worldGen.nextInt(4);
    }

    for (let j = 0; j < numSmallNodes; ++j) {
      const angleY = Math.random() * Math.PI * 2.0;
      const angleZ = (Math.random() - 0.5) * 0.25;
      let angleX = Math.random() * 2.0 + Math.random();

      if (worldGen.nextInt(10) === 0) {
        angleX *= Math.random() * Math.random() * 3.0 + 1.0;
      }

      generateCaveNode(xCenter, zCenter, world, cX, cY, cZ, angleX, angleY, angleZ, 0, 0, 1.0);
    }
  }
}

function generate(world, i, j) {
  for (let x = i - 8; x <= i + 8; x++) {
    for (let y = j - 8; y <= j + 8; y++) {
      genCaves(world, i, j, x, y);
    }
  }
  return world;
}

worldGen.genTypes[0] = Object.freeze({
  generate,
});
