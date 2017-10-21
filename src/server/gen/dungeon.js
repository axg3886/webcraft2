/* eslint-env browser */
/*
	Dungeon Generator
	Copyright Ashwin Ganapathiraju, 2011-2016
	Provided and modified for: IGME-330 Project 2.
	Contact for other usage at: axg3886@rit.edu
*/
/* globals worldGen */

worldGen.genTypes.push(Object.freeze(
	function () {
  function genCorridor(world, z) {
    let wall = worldGen.getRandomWall(world, z),
      len = nextInt(5) + 3;

    if (wall === undefined) {
      return false;
    }

    switch (worldGen.nextTo(world, wall.x, wall.y, z, worldGen.TYPES.air)) {
      case 3: // right
        if (!worldGen.fillRect(world, wall.x - len, wall.y, z, len, 1, worldGen.TYPES.air)) {
          return false;
        }
        break;

      case 4: // bottom
        if (!worldGen.fillRect(world, wall.x, wall.y - len, z, 1, len, worldGen.TYPES.air)) {
          return false;
        }
        break;

      case 1: // left
        if (!worldGen.fillRect(world, wall.x, wall.y, z, len, 1, worldGen.TYPES.air)) {
          return false;
        }
        break;

      case 2: // top
        if (!worldGen.fillRect(world, wall.x, wall.y, z, 1, len, worldGen.TYPES.air)) {
          return false;
        }
        break;

      default:
        return false;
    }

    world.set(wall.x, wall.y, z, worldGen.TYPES.air);
    return true;
  }

  function genRoom(world, z) {
    let wall = worldGen.getRandomWall(world, z),
      len = nextInt(3) + 3;

    if (wall === undefined || worldGen.countNext(world, wall.x, wall.y, z, worldGen.TYPES.wall) <= 1) {
      return false;
    }

    switch (worldGen.nextTo(world, wall.x, wall.y, z, worldGen.TYPES.air)) {
      case 3: // right
        if (!worldGen.fillRect(world, wall.x - len, wall.y, z, len, len, worldGen.TYPES.air)) {
          return false;
        }
        world.set(wall.x + 1, wall.y, z, worldGen.TYPES.air);
        break;

      case 4: // bottom
        if (!worldGen.fillRect(world, wall.x, wall.y - len, z, len, len, worldGen.TYPES.air)) {
          return false;
        }
        world.set(wall.x, wall.y + 1, z, worldGen.TYPES.air);
        break;

      case 1: // left
        if (!worldGen.fillRect(world, wall.x, wall.y, z, len, len, worldGen.TYPES.air)) {
          return false;
        }
        world.set(wall.x - 1, wall.y, z, worldGen.TYPES.air);
        break;

      case 2: // top
        if (!worldGen.fillRect(world, wall.x - len, wall.y, z, len, len, worldGen.TYPES.air)) {
          return false;
        }
        world.set(wall.x - 1, wall.y - 1, z, worldGen.TYPES.air);
        break;

      default:
        return false;
    }
    world.set(wall.x, wall.y, z, worldGen.TYPES.air);
    return true;
  }

  function generate(world) {
    let passes = worldGen.CHUNK_SIZE,
      k,
      bk,
      stair,
      x,
      y,
      z;

    x = nextInt(worldGen.WORLD_SIZE);
    y = nextInt(worldGen.WORLD_SIZE);
    z = nextInt(worldGen.CHUNK_HEIGHT);
    console.log(`${x}, ${y}, ${z}`);
    worldGen.fillRect(world, x - 3, y - 3, z, 6, 6, worldGen.TYPES.air);
    worldGen.genWalls(world);
			// world.set(x, y, worldGen.TYPES.stair);

    for (k = 0; k < passes; k++) {
      bk = nextInt(20) + 2;
      if (nextInt(40) === 0) {
        while (!genRoom(world, z) && bk < 22) { bk++; }
      } else {
        while (!genCorridor(world, z) && bk < 22) { bk++; }
      }
      worldGen.genWalls(world);
    }
			// stair = worldGen.getRandomWall(world, z);
    if (stair !== undefined) {
      world.set(stair.x, stair.y, stair.z, worldGen.TYPES.stair);
      worldGen.genWalls(world);
      world.stairs = stair;
    }
    return world;
  }

  return {
    generate,
  };
}()
));
