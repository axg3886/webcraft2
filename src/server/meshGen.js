/*
  Mesh Generation Module
  Copyright Ashwin Ganapathiraju, 2017
  Written in Javascript for: IGME-330 Project 2.
  Under conversion to Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const worldGen = require('./gen/worldgen.js');

// Determines whether a block should be composed into the chunk mesh
// @param { number } b - the block to test
// @param { 1 = transparent } type - What type is it
const isBlockSolid = (b, type) => worldGen.TYPE_CUBE[b] &&
  (type === 1 ? worldGen.TYPE_OPAQUE[b] : !(worldGen.TYPE_OPAQUE[b]));

// Optimization trick - _only do this once_, since it never changes.
const standardMeshData = ((() => {
  // Vertex tex-coords - map into a mega-texture
  const meshVt = [];
  // Vertex normals - there are really only six of these (because cube)
  const meshVn = [];

  // This will fill out the mega-texture, which allows for 32 different textures
  for (let i = 0; i < 32; ++i) {
    // x and y are offset values
    const x = (i % 4) / 4.0;
    const y = Math.floor(i / 4) / 8.0;

    const s = 0.25;

    meshVt.push((`vt ${0.00 * s + x} ${0.50 * s + y} \n`));
    meshVt.push((`vt ${0.25 * s + x} ${0.50 * s + y} \n`));
    meshVt.push((`vt ${0.50 * s + x} ${0.50 * s + y} \n`));

    meshVt.push((`vt ${0.00 * s + x} ${0.25 * s + y} \n`));
    meshVt.push((`vt ${0.25 * s + x} ${0.25 * s + y} \n`));
    meshVt.push((`vt ${0.50 * s + x} ${0.25 * s + y} \n`));
    meshVt.push((`vt ${0.75 * s + x} ${0.25 * s + y} \n`));
    meshVt.push((`vt ${1.00 * s + x} ${0.25 * s + y} \n`));

    meshVt.push((`vt ${0.00 * s + x} ${0.00 * s + y} \n`));
    meshVt.push((`vt ${0.25 * s + x} ${0.00 * s + y} \n`));
    meshVt.push((`vt ${0.50 * s + x} ${0.00 * s + y} \n`));
    meshVt.push((`vt ${0.75 * s + x} ${0.00 * s + y} \n`));
    meshVt.push((`vt ${1.00 * s + x} ${0.00 * s + y} \n`));
  }

  meshVn.push((`vn ${0} ${0} ${1}\n`));
  meshVn.push((`vn ${0} ${0} ${-1}\n`));
  meshVn.push((`vn ${0} ${1} ${0}\n`));
  meshVn.push((`vn ${0} ${-1} ${0}\n`));
  meshVn.push((`vn ${1} ${0} ${0}\n`));
  meshVn.push((`vn ${-1} ${0} ${0}\n`));

  const meshVtS = meshVt.reduce((a, b) => a + b, '');
  const meshVnS = meshVn.reduce((a, b) => a + b, '');

  return meshVtS + meshVnS;
})());

// Generates a string that the rendering engine can convert into a mesh on the GPU
// Route the return of this straight into initMesh in graphics
// @param { array? } ochunk - you should probably send it a chunk
// @param { 1 = transparent } type - what chunk type are we building
function generateChunkMesh(chunk, type) {
  // Vertex positions - the only one that actually needs to be built
  const meshV = [];
  // Faces - this one gets a little more interesting I suppose
  const meshF = [];

  // Number of faces created thus far
  let faces = 0;

  // I can't believe I'm reverse-engineering my own rendering engine
  for (let i = 0; i < worldGen.CHUNK_HEIGHT *
            worldGen.CHUNK_SIZE *
            worldGen.CHUNK_SIZE; ++i) {
    const x = i % worldGen.CHUNK_SIZE;
    const y = Math.floor(i / (worldGen.CHUNK_SIZE * worldGen.CHUNK_SIZE));
    const z = Math.floor(i / worldGen.CHUNK_SIZE) % worldGen.CHUNK_SIZE;

    const block = chunk.get(x, y, z);

    // Don't bother with this block if it isn't real - abort
    if (!(isBlockSolid(block, type))) {
      continue;
    }

    // At this point, we are certain the block exists - check each side and build

    const bX = (-0.50 + x);
    const aX = (0.50 + x);
    const bY = (-0.50 + y);
    const aY = (0.50 + y);
    const bZ = (-0.50 + z);
    const aZ = (0.50 + z);

    let f = faces * 4 + 1;
    const b = (block - 1) * 13 + 1;

    // Left - side note : I love short-circuit evaluation
    if (x === 0 || !(isBlockSolid(chunk.get(x - 1, y, z), type))) {
      meshV.push((`v ${bX} ${bY} ${aZ}\n`));
      meshV.push((`v ${bX} ${aY} ${bZ}\n`));
      meshV.push((`v ${bX} ${bY} ${bZ}\n`));
      meshV.push((`v ${bX} ${aY} ${aZ}\n`));

      meshF.push(`f ${f + 0}/${b + 9}/${6} ${f + 1}/${b + 3}/${6} ${f + 2}/${b + 8}/${6}\n`);

      meshF.push(`f ${f + 0}/${b + 9}/${6} ${f + 3}/${b + 4}/${6} ${f + 1}/${b + 3}/${6}\n`);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Right
    if (x === worldGen.CHUNK_SIZE - 1 || !(isBlockSolid(chunk.get(x + 1, y, z), type))) {
      meshV.push((`v ${aX} ${bY} ${bZ}\n`));
      meshV.push((`v ${aX} ${aY} ${aZ}\n`));
      meshV.push((`v ${aX} ${bY} ${aZ}\n`));
      meshV.push((`v ${aX} ${aY} ${bZ}\n`));

      meshF.push(`f ${f + 0}/${b + 11}/${5} ${f + 1}/${b + 5}/${5} ${f + 2}/${b + 10}/${5}\n`);

      meshF.push(`f ${f + 0}/${b + 11}/${5} ${f + 3}/${b + 6}/${5} ${f + 1}/${b + 5}/${5}\n`);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Front
    if (z === worldGen.CHUNK_SIZE - 1 || !(isBlockSolid(chunk.get(x, y, z + 1), type))) {
      meshV.push((`v ${aX} ${bY} ${aZ}\n`));
      meshV.push((`v ${bX} ${aY} ${aZ}\n`));
      meshV.push((`v ${bX} ${bY} ${aZ}\n`));
      meshV.push((`v ${aX} ${aY} ${aZ}\n`));

      meshF.push(`f ${f + 0}/${b + 10}/${1} ${f + 1}/${b + 4}/${1} ${f + 2}/${b + 9}/${1}\n`);

      meshF.push(`f ${f + 0}/${b + 10}/${1} ${f + 3}/${b + 5}/${1} ${f + 1}/${b + 4}/${1}\n`);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Back
    if (z === 0 || !(isBlockSolid(chunk.get(x, y, z - 1), type))) {
      meshV.push((`v ${bX} ${bY} ${bZ}\n`));
      meshV.push((`v ${aX} ${aY} ${bZ}\n`));
      meshV.push((`v ${aX} ${bY} ${bZ}\n`));
      meshV.push((`v ${bX} ${aY} ${bZ}\n`));

      meshF.push(`f ${f + 0}/${b + 12}/${2} ${f + 1}/${b + 6}/${2} ${f + 2}/${b + 11}/${2}\n`);

      meshF.push(`f ${f + 0}/${b + 12}/${2} ${f + 3}/${b + 7}/${2} ${f + 1}/${b + 6}/${2}\n`);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Top
    if (y === worldGen.CHUNK_HEIGHT - 1 || !(isBlockSolid(chunk.get(x, y + 1, z), type))) {
      meshV.push((`v ${aX} ${aY} ${aZ}\n`));
      meshV.push((`v ${bX} ${aY} ${bZ}\n`));
      meshV.push((`v ${bX} ${aY} ${aZ}\n`));
      meshV.push((`v ${aX} ${aY} ${bZ}\n`));

      meshF.push(`f ${f + 0}/${b + 5}/${3} ${f + 1}/${b + 1}/${3} ${f + 2}/${b + 4}/${3}\n`);

      meshF.push(`f ${f + 0}/${b + 5}/${3} ${f + 3}/${b + 2}/${3} ${f + 1}/${b + 1}/${3}\n`);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Bottom
    if (y === 0 || !(isBlockSolid(chunk.get(x, y - 1, z), type))) {
      meshV.push((`v ${bX} ${bY} ${aZ}\n`));
      meshV.push((`v ${aX} ${bY} ${bZ}\n`));
      meshV.push((`v ${aX} ${bY} ${aZ}\n`));
      meshV.push((`v ${bX} ${bY} ${bZ}\n`));

      meshF.push(`f ${f + 0}/${b + 3}/${4} ${f + 1}/${b + 1}/${4} ${f + 2}/${b + 4}/${4}\n`);

      meshF.push(`f ${f + 0}/${b + 3}/${4} ${f + 3}/${b + 0}/${4} ${f + 1}/${b + 1}/${4}\n`);

      faces += 1;
      f = faces * 4 + 1;
    }
  }

  const meshVS = meshV.reduce((a, b) => a + b, '');
  const meshFS = meshF.reduce((a, b) => a + b, '');

  return meshVS + standardMeshData + meshFS;
}

module.exports.generateChunkMesh = generateChunkMesh;
