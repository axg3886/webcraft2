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
const standardMeshData = () => {
  const meshObj = {
    // Vertex positions - the only one that actually needs to be built
    vp: [],
    // Vertex normals - there are really only six of these (because cube)
    vn: [],
    // Vertex tex-coords - map into a mega-texture
    vt: [],
    // Faces - this one gets a little more interesting I suppose
    faces: [],
  };

  // This will fill out the mega-texture, which allows for 32 different textures
  for (let i = 0; i < 32; ++i) {
    // x and y are offset values
    const x = (i % 4) / 4.0;
    const y = Math.floor(i / 4) / 8.0;

    const s = 0.25;

    meshObj.vt.push(0.00 * s + x); meshObj.vt.push(0.50 * s + y);
    meshObj.vt.push(0.25 * s + x); meshObj.vt.push(0.50 * s + y);
    meshObj.vt.push(0.50 * s + x); meshObj.vt.push(0.50 * s + y);

    meshObj.vt.push(0.00 * s + x); meshObj.vt.push(0.25 * s + y);
    meshObj.vt.push(0.25 * s + x); meshObj.vt.push(0.25 * s + y);
    meshObj.vt.push(0.50 * s + x); meshObj.vt.push(0.25 * s + y);
    meshObj.vt.push(0.75 * s + x); meshObj.vt.push(0.25 * s + y);
    meshObj.vt.push(1.00 * s + x); meshObj.vt.push(0.25 * s + y);

    meshObj.vt.push(0.00 * s + x); meshObj.vt.push(0.00 * s + y);
    meshObj.vt.push(0.25 * s + x); meshObj.vt.push(0.00 * s + y);
    meshObj.vt.push(0.50 * s + x); meshObj.vt.push(0.00 * s + y);
    meshObj.vt.push(0.75 * s + x); meshObj.vt.push(0.00 * s + y);
    meshObj.vt.push(1.00 * s + x); meshObj.vt.push(0.00 * s + y);
  }

  meshObj.vn.push(0); meshObj.vn.push(0); meshObj.vn.push(1);
  meshObj.vn.push(0); meshObj.vn.push(0); meshObj.vn.push(-1);
  meshObj.vn.push(0); meshObj.vn.push(1); meshObj.vn.push(0);
  meshObj.vn.push(0); meshObj.vn.push(-1); meshObj.vn.push(0);
  meshObj.vn.push(1); meshObj.vn.push(0); meshObj.vn.push(0);
  meshObj.vn.push(-1); meshObj.vn.push(0); meshObj.vn.push(0);

  return meshObj;
};

// Generates a string that the rendering engine can convert into a mesh on the GPU
// Route the return of this straight into initMesh in graphics
// @param { array? } ochunk - you should probably send it a chunk
// @param { 1 = transparent } type - what chunk type are we building
function generateChunkMesh(chunk, type) {
  // A modifiable copy of the standard mesh data
  const meshData = standardMeshData();

  // Number of faces created thus far
  let faces = 0;

  // I can't believe I'm reverse-engineering my own rendering engine
  // EDIT: Haha, not true anymore!
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
      meshData.vp.push(bX); meshData.vp.push(bY); meshData.vp.push(aZ);
      meshData.vp.push(bX); meshData.vp.push(aY); meshData.vp.push(bZ);
      meshData.vp.push(bX); meshData.vp.push(bY); meshData.vp.push(bZ);
      meshData.vp.push(bX); meshData.vp.push(aY); meshData.vp.push(aZ);

      meshData.faces.push(f + 0); meshData.faces.push(b + 9); meshData.faces.push(6);
      meshData.faces.push(f + 1); meshData.faces.push(b + 3); meshData.faces.push(6);
      meshData.faces.push(f + 2); meshData.faces.push(b + 8); meshData.faces.push(6);

      meshData.faces.push(f + 0); meshData.faces.push(b + 9); meshData.faces.push(6);
      meshData.faces.push(f + 3); meshData.faces.push(b + 4); meshData.faces.push(6);
      meshData.faces.push(f + 1); meshData.faces.push(b + 3); meshData.faces.push(6);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Right
    if (x === worldGen.CHUNK_SIZE - 1 || !(isBlockSolid(chunk.get(x + 1, y, z), type))) {
      meshData.vp.push(aX); meshData.vp.push(bY); meshData.vp.push(bZ);
      meshData.vp.push(aX); meshData.vp.push(aY); meshData.vp.push(aZ);
      meshData.vp.push(aX); meshData.vp.push(bY); meshData.vp.push(aZ);
      meshData.vp.push(aX); meshData.vp.push(aY); meshData.vp.push(bZ);

      meshData.faces.push(f + 0); meshData.faces.push(b + 11); meshData.faces.push(5);
      meshData.faces.push(f + 1); meshData.faces.push(b + 5); meshData.faces.push(5);
      meshData.faces.push(f + 2); meshData.faces.push(b + 10); meshData.faces.push(5);

      meshData.faces.push(f + 0); meshData.faces.push(b + 11); meshData.faces.push(5);
      meshData.faces.push(f + 3); meshData.faces.push(b + 6); meshData.faces.push(5);
      meshData.faces.push(f + 1); meshData.faces.push(b + 5); meshData.faces.push(5);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Front
    if (z === worldGen.CHUNK_SIZE - 1 || !(isBlockSolid(chunk.get(x, y, z + 1), type))) {
      meshData.vp.push(aX); meshData.vp.push(bY); meshData.vp.push(aZ);
      meshData.vp.push(bX); meshData.vp.push(aY); meshData.vp.push(aZ);
      meshData.vp.push(bX); meshData.vp.push(bY); meshData.vp.push(aZ);
      meshData.vp.push(aX); meshData.vp.push(aY); meshData.vp.push(aZ);

      meshData.faces.push(f + 0); meshData.faces.push(b + 10); meshData.faces.push(1);
      meshData.faces.push(f + 1); meshData.faces.push(b + 4); meshData.faces.push(1);
      meshData.faces.push(f + 2); meshData.faces.push(b + 9); meshData.faces.push(1);

      meshData.faces.push(f + 0); meshData.faces.push(b + 10); meshData.faces.push(1);
      meshData.faces.push(f + 3); meshData.faces.push(b + 5); meshData.faces.push(1);
      meshData.faces.push(f + 1); meshData.faces.push(b + 4); meshData.faces.push(1);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Back
    if (z === 0 || !(isBlockSolid(chunk.get(x, y, z - 1), type))) {
      meshData.vp.push(bX); meshData.vp.push(bY); meshData.vp.push(bZ);
      meshData.vp.push(aX); meshData.vp.push(aY); meshData.vp.push(bZ);
      meshData.vp.push(aX); meshData.vp.push(bY); meshData.vp.push(bZ);
      meshData.vp.push(bX); meshData.vp.push(aY); meshData.vp.push(bZ);

      meshData.faces.push(f + 0); meshData.faces.push(b + 12); meshData.faces.push(2);
      meshData.faces.push(f + 1); meshData.faces.push(b + 6); meshData.faces.push(2);
      meshData.faces.push(f + 2); meshData.faces.push(b + 11); meshData.faces.push(2);

      meshData.faces.push(f + 0); meshData.faces.push(b + 12); meshData.faces.push(2);
      meshData.faces.push(f + 3); meshData.faces.push(b + 7); meshData.faces.push(2);
      meshData.faces.push(f + 1); meshData.faces.push(b + 6); meshData.faces.push(2);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Top
    if (y === worldGen.CHUNK_HEIGHT - 1 || !(isBlockSolid(chunk.get(x, y + 1, z), type))) {
      meshData.vp.push(aX); meshData.vp.push(aY); meshData.vp.push(aZ);
      meshData.vp.push(bX); meshData.vp.push(aY); meshData.vp.push(bZ);
      meshData.vp.push(bX); meshData.vp.push(aY); meshData.vp.push(aZ);
      meshData.vp.push(aX); meshData.vp.push(aY); meshData.vp.push(bZ);

      meshData.faces.push(f + 0); meshData.faces.push(b + 5); meshData.faces.push(3);
      meshData.faces.push(f + 1); meshData.faces.push(b + 1); meshData.faces.push(3);
      meshData.faces.push(f + 2); meshData.faces.push(b + 4); meshData.faces.push(3);

      meshData.faces.push(f + 0); meshData.faces.push(b + 5); meshData.faces.push(3);
      meshData.faces.push(f + 3); meshData.faces.push(b + 2); meshData.faces.push(3);
      meshData.faces.push(f + 1); meshData.faces.push(b + 1); meshData.faces.push(3);

      faces += 1;
      f = faces * 4 + 1;
    }

    // Bottom
    if (y === 0 || !(isBlockSolid(chunk.get(x, y - 1, z), type))) {
      meshData.vp.push(bX); meshData.vp.push(bY); meshData.vp.push(aZ);
      meshData.vp.push(aX); meshData.vp.push(bY); meshData.vp.push(bZ);
      meshData.vp.push(aX); meshData.vp.push(bY); meshData.vp.push(aZ);
      meshData.vp.push(bX); meshData.vp.push(bY); meshData.vp.push(bZ);

      meshData.faces.push(f + 0); meshData.faces.push(b + 3); meshData.faces.push(4);
      meshData.faces.push(f + 1); meshData.faces.push(b + 1); meshData.faces.push(4);
      meshData.faces.push(f + 2); meshData.faces.push(b + 4); meshData.faces.push(4);

      meshData.faces.push(f + 0); meshData.faces.push(b + 3); meshData.faces.push(4);
      meshData.faces.push(f + 3); meshData.faces.push(b + 0); meshData.faces.push(4);
      meshData.faces.push(f + 1); meshData.faces.push(b + 1); meshData.faces.push(4);

      faces += 1;
      f = faces * 4 + 1;
    }
  }
  return Object.freeze(meshData);
}

module.exports.generateChunkMesh = generateChunkMesh;
