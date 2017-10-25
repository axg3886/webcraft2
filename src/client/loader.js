/*
loader.js
variable 'app' is in global scope - i.e. a property of window.
app is our single global object literal - all other functions and properties of
the game will be properties of app.
*/

// if app exists use the existing copy
// else create a new empty object literal
const app = window.app || {};

window.onload = () => {
  app.main.myKeys = app.myKeys;
  app.main.graphics = app.graphics;
  app.main.audio = app.audio;
  app.main.init();
};

window.onblur = () => {
  app.main.pauseGame();
};

window.onfocus = () => {
  app.main.resumeGame();
};
