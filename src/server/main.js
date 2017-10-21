/*
  Node Server
  Copyright Ashwin Ganapathiraju, 2017
  Written in Node.js for: IGME-590 Project 2.
  Contact for other usage at: axg3886@rit.edu
*/
const http = require('http');
const path = require('path');
const express = require('express');
const socketio = require('socket.io');
const game = require('./game.js');

const PORT = process.env.PORT || process.env.NODE_PORT || 3000;

const app = express();

app.use('/assets', express.static(path.resolve(`${__dirname}/../../assets/`)));

app.get('/', (req, res) => {
  res.sendFile(path.resolve(`${__dirname}/../../assets/index.html`));
});

const server = http.createServer(app);
const io = socketio(server);

game.startSocketServer(io);

server.listen(PORT, (err) => {
  if (err) {
    throw err;
  }
  /* eslint-disable no-console */
  // Done to prevent warning for this one line
  console.log(`Listening on 127.0.0.1:${PORT}`);
  /* eslint-enable no-console */
});
