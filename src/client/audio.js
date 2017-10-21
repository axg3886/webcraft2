var app = app || {};

let AudioPlayer = null;

// There's not really a whole lot to do here, really this is all just syntactic sugar to make audio code look more like the rest of the codebase
app.audio = (function () {
  const loadedSounds = {};

	// Loads a sound to be played
	// @param { string } src - the filepath of the sound to load
	// @param { string } id - the id name to use to represent the sound once loaded
  function loadSound(src, id)	{
		// Don't try to load a sound twice; probably not needed but better safe than sorry
    if (loadedSounds[id]) { return; }

    createjs.Sound.registerSound(src, id);
    loadedSounds[id] = true;
  }

	// Creates an AudioPlayer, used to play audio
	// Once created, id can be changed freely to any loaded sound
	// @param { string } id - id of the sound to play
  AudioPlayer = function (id)	{
    this.id = id;

    this.play = function ()		{
      this.sound = createjs.Sound.play(id);
    };

    this.pause = function ()		{
      if (this.sound) {
        this.sound.paused = true;
      }
    };

    this.resume = function ()		{
      if (this.sound) {
        this.sound.paused = false;
      }
    };
  };

  return {
    loadSound,
  };
}());
