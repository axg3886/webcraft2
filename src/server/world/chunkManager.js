/*
  Chunk Manager
  Copyright Ashwin Ganapathiraju, 2011-2017
  Written in Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const SQLStatements = require('./sqlStatements.js');
const worldGen = require('../gen/worldgen.js');
const sqlite3 = require('sqlite3').verbose();

const db = new sqlite3.Database(''); // Anonymous harddisk database
db.serialize(() => {
  db.run(SQLStatements.CREATE_TABLE_CHUNKS);
});

const chunkExistsStatement = db.prepare(SQLStatements.CHUNK_EXISTS);
const chunkWriteStatement = db.prepare(SQLStatements.CREATE_NEW_CHUNK);
const loadedChunks = {};
const chunkLoadedRecievers = []; // List of objects with method onChunkLoaded(chunk) to call

const getChunk = (x, z) => {
  if (loadedChunks[`${x},${z}`]) {
    return loadedChunks[`${x},${z}`];
  }
  chunkExistsStatement.all({ $x: x, $z: z }, (err, rows) => {
    const chunk = worldGen.makeChunk(x, z);
    if (rows.length > 0) {
      chunk.read(rows[0].data);
      chunk.readMesh(rows[0].data);
    } else {
      // Because that'll work properly!
      worldGen.generateChunk(module.exports, chunk);
      chunkWriteStatement.run({
        $x: x, $z: z,
        $data: chunk.write(),
        $mesh: chunk.writeMesh(),
      });
    }
    chunk.recalcHeight();
    loadedChunks[`${x},${z}`] = chunk;
    for (let i = 0; i < chunkLoadedRecievers.length; i++) {
      chunkLoadedRecievers[i].onChunkLoaded(chunk);
    }
  });
  return undefined;
};

const chunk = (x, z, o) => { const c = getChunk(x >> 4, z >> 4); return c ? o(c) : undefined; };
const get = (x, y, z) => chunk(x, z, c => c.get(x % 16, y, z % 16));
const set = (x, y, z, v) => { chunk(x, z, c => c.set(x % 16, y, z % 16, v)); };
const height = (x, z) => chunk(x, z, c => c.height(x % 16, z % 16));

module.exports = Object.freeze({
  get,
  set,
  getChunk,
  height,
  chunkLoadedRecievers,
});
