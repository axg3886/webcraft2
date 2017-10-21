/* jslint browser:true */
/* jslint plusplus: true */

/* imported app */
var app = app || {};

app.main = app.main || (
  function () {
  return {
      // Properties
    GAME: ({
      WIDTH: window.innerWidth - 20,
      HEIGHT: window.innerHeight - 20,
    }),
    GAME_STATE: Object.freeze({
      LOADING: 0,
      BEGIN: 1,
      DEFAULT: 2,
      PAUSED: 3,
    }),
    canvas: undefined,

      // Used by calculateDeltaTime()
    lastTime: 0,
    debug: true,
    handleKeyPress: false,
    animationID: 0,
    gameState: undefined,

      // Keyboard input handling
    myKeys: undefined,

      // Will provide a rendering API to go through WebGL
    graphics: undefined,
    standardTextures: { diffuseTexture: 'assets/textures/master.png', specularTexture: 'assets/textures/masterSpecular.png', emissionTexture: 'assets/textures/masterEmission.png' },

      // Audio stuff
    audio: undefined,
    musicPaused: false,
    musicPlayer: null,

    genWorker: undefined,
    genMessage: '',
    genStr: '          ',
    genPercent: 0.0.toFixed(2),

    pmouse: null,

    sun: null,
      // Time it takes to cycle through a day
    cycleTime: 240000,
    worldTime: 0,

    musicPlayer: null,

    torchParticle: null,
    torch: null,

    sunRender: null,
    moonRender: null,

      // methods
    init() {
        // Initialize properties
      this.canvas = document.querySelector('#txCanvas');
      this.canvas.onmousedown = this.doMousedown.bind(this);
      document.addEventListener('pointerlockchange', this.lockChangeAlert.bind(this), false);
      document.addEventListener('mozpointerlockchange', this.lockChangeAlert.bind(this), false);

      this.graphics.init(this.GAME.WIDTH, this.GAME.HEIGHT);
        // this.graphics.loadMesh("assets/meshes/stairs.obj");

      this.audio.loadSound('assets/sounds/BossaBossa.mp3', 'bossa');

      this.musicPlayer = new AudioPlayer('bossa');
      this.musicPlayer.time = 3.0;

      this.graphics.loadTexture('assets/textures/master.png');
      this.graphics.loadTexture('assets/textures/masterSpecular.png');
      this.graphics.loadTexture('assets/textures/masterEmission.png');

      this.graphics.loadTexture('assets/textures/torchDiffuse.png');
      this.graphics.loadTexture('assets/textures/torchEmission.png');

      this.graphics.loadTexture('assets/textures/sun.png');
      this.graphics.loadTexture('assets/textures/moon.png');

      this.sun = new DirectionalLight({ direction: $V([-1, -1, -1]).toUnitVector(), intensity: $V([0.4, 0.36, 0.32]) });
      this.sun.register();

      this.sunRender = new MeshRenderable({
        mesh: 'assets/meshes/cube.obj',
        rotation: $V([0.0, -Math.PI / 2, 0.0]),
        scale: $V([10, 10, 10]),
        textures: {
          emissionTexture: 'assets/textures/sun.png',
        },
      });
      this.sunRender.register();

      this.moonRender = new MeshRenderable({
        mesh: 'assets/meshes/cube.obj',
        rotation: $V([0.0, -Math.PI / 2, 0.0]),
        scale: $V([10, 10, 10]),
        textures: {
          emissionTexture: 'assets/textures/moon.png',
        },
      });
      this.moonRender.register();


      window.onresize = (function (e)       {
        this.GAME.WIDTH = window.innerWidth - 20;
        this.GAME.HEIGHT = window.innerHeight - 20;
        this.graphics.resize(this.GAME.WIDTH, this.GAME.HEIGHT);
      }.bind(this));

      this.gameState = this.GAME_STATE.LOADING;

      this.genWorker = io.connect();
      this.genWorker.on('connect', (function() {
        this.genWorker.on('genMsg', (function(data) {
          this.genMessage = data.genMessage;
          this.genStr = data.genStr;
          this.genPercent = data.genPercent;
        }).bind(this));

        this.genWorker.on('meshData', (function(data) {
          const meshData = data.meshData;
          for (let i = 0; i < meshData.str.length; i++) {
            const tex = `chunk${meshData.chunkIndex}-${i}`;
            this.graphics.initMesh(meshData.str[i], tex);
            const mesh = new MeshRenderable({
              textures: this.standardTextures,
              mesh: tex,
              posOnly: true,
              opaque: i != 0,
              position: $V([meshData.chunkX, 0, meshData.chunkZ]),
            });
            mesh.register();
          }
          if (data.finished) {
            this.graphics.getActiveCamera().transform.position = Vector.create([-10, 60, 50]);
            this.graphics.getActiveCamera().transform.rotation = $V([-0.6, 0, 0]);
            this.gameState = this.GAME_STATE.BEGIN;
          }
        }).bind(this));

      }).bind(this));

      this.torchParticle = new ParticleRenderable({});
      this.torchParticle.register();

      this.torch = new MeshRenderable({ scale: $V([0.05, 0.4, 0.05]), rotation: $V([-0.2, 0.0, 0.2]), textures: { diffuseTexture: 'assets/textures/torchDiffuse.png', emissionTexture: 'assets/textures/torchEmission.png' } });
      this.torch.register();

        // Start the game loop
      this.update();
    },

    update() {
      this.animationID = requestAnimationFrame(this.update.bind(this));

      const dt = this.calculateDeltaTime();
      const cam = this.graphics.getActiveCamera().transform;

      if (this.gameState === this.GAME_STATE.LOADING) {
        this.graphics.clear();
        this.graphics.drawText('WEBCRAFT 2', this.GAME.WIDTH / 2 - 128, this.GAME.HEIGHT / 2 - 18, '32pt courier', '#22ff22');
        this.graphics.drawText(this.genMessage, this.GAME.WIDTH / 2 - (this.genMessage.length * 8), this.GAME.HEIGHT / 2 + 20, '16pt courier', '#fff');
        this.graphics.drawText(`[${this.genStr}] ${this.genPercent}%`, this.GAME.WIDTH / 2 - 162, this.GAME.HEIGHT / 2 + 80, '18pt courier', '#fff');
      }       else if (this.gameState === this.GAME_STATE.BEGIN) {
        this.graphics.clear();
        this.graphics.drawText('WEBCRAFT 2', this.GAME.WIDTH / 2 - 128, this.GAME.HEIGHT / 2 - 18, '32pt courier', '#22ff22');
        this.graphics.drawText('Click to start', this.GAME.WIDTH / 2 - 112, this.GAME.HEIGHT / 2 + 20, '16pt courier', '#fff');
        this.graphics.drawText('Instructions:', this.GAME.WIDTH / 2 - 117, this.GAME.HEIGHT / 2 + 80, '18pt courier', '#fff');
        this.graphics.drawText('WASDEQ to move', this.GAME.WIDTH / 2 - 126, this.GAME.HEIGHT / 2 + 115, '18pt courier', 'A0A0A0');
        this.graphics.drawText('Arrows to pan', this.GAME.WIDTH / 2 - 117, this.GAME.HEIGHT / 2 + 140, '18pt courier', 'A0A0A0');
        this.graphics.drawText('PO for music', this.GAME.WIDTH / 2 - 108, this.GAME.HEIGHT / 2 + 165, '18pt courier', 'A0A0A0');
        this.worldTime = this.cycleTime / 4;
      }       else if (this.gameState === this.GAME_STATE.PAUSED) {
        this.graphics.clear();
        this.graphics.drawText('PAUSED', this.GAME.WIDTH / 2 - 54, this.GAME.HEIGHT / 2 - 9, '18pt courier', '#fff');
      }       else if (this.gameState === this.GAME_STATE.DEFAULT)        {
        if (this.handleKeyPress)          {
          this.keyCheck(dt);
        }

        this.graphics.draw(dt);

        this.musicPlayer.time -= dt;
        if (this.musicPlayer.time <= 0.0)         {
          this.musicPlayer.time = 170.0;
          this.musicPlayer.play();
        }
      }

      if (this.debug) {
        const pos = cam.position.elements;
          // Draw camera in top left corner
        this.graphics.drawText(`x : ${(pos[0]).toFixed(1)}`, 8, 20, '10pt courier', '#A0A0A0');
        this.graphics.drawText(`y : ${(pos[1]).toFixed(1)}`, 8, 32, '10pt courier', '#A0A0A0');
        this.graphics.drawText(`z : ${(pos[2]).toFixed(1)}`, 8, 44, '10pt courier', '#A0A0A0');
          // Draw rtime in top right corner
        this.graphics.drawText(this.readableTime(), this.GAME.WIDTH - 60, 20, '10pt courier', '#A0A0A0');
          // Draw fps in bottom left corner
        this.graphics.drawText(`fps : ${(1 / dt).toFixed(3)}`, 8, this.GAME.HEIGHT - 10, '18pt courier', '#A0A0A0');
          // Draw dt in bottom right corner
        this.graphics.drawText(`dt : ${dt.toFixed(3)}`, this.GAME.WIDTH - 150, this.GAME.HEIGHT - 10, '18pt courier', '#A0A0A0');
      }

      this.handleSky();
    },

    keyCheck(dt) {
      const cam = this.graphics.getActiveCamera().transform;
      const yaw = cam.rotation.elements[1];
      if (this.myKeys.keydown[87]) // forward - w
        {
        cam.position.elements[0] -= Math.sin(yaw) * 20 * dt;
        cam.position.elements[2] -= Math.cos(yaw) * 20 * dt;
      }
      if (this.myKeys.keydown[83]) // back - s
        {
        cam.position.elements[0] += Math.sin(yaw) * 20 * dt;
        cam.position.elements[2] += Math.cos(yaw) * 20 * dt;
      }
      if (this.myKeys.keydown[65]) // left - a
        {
        cam.position.elements[0] -= Math.cos(yaw) * 20 * dt;
        cam.position.elements[2] += Math.sin(yaw) * 20 * dt;
      }
      if (this.myKeys.keydown[68]) // right - d
        {
        cam.position.elements[0] += Math.cos(yaw) * 20 * dt;
        cam.position.elements[2] -= Math.sin(yaw) * 20 * dt;
      }
      if (this.myKeys.keydown[81]) // down - q
        {
        cam.position.elements[1] -= 20 * dt;
      }
      if (this.myKeys.keydown[69]) // up - e
        {
        cam.position.elements[1] += 20 * dt;
      }

        // Inverted up/down
      if (this.myKeys.keydown[38]) // up
        {
        cam.rotation.elements[0] -= 2 * dt; // look up
      }
      if (this.myKeys.keydown[40]) // down
        {
        cam.rotation.elements[0] += 2 * dt; // peer down
      }
      if (this.myKeys.keydown[37]) // left
        {
        cam.rotation.elements[1] += 2 * dt; // look left
      }
      if (this.myKeys.keydown[39]) // right
        {
        cam.rotation.elements[1] -= 2 * dt; // peer right
      }

      cam.rotation.elements[0] = clamp(cam.rotation.elements[0], -1.5, 1.5);

      const x = -Math.sin(cam.rotation.elements[1] - 0.4) * 1.5;
      const z = -Math.cos(cam.rotation.elements[1] - 0.4) * 1.5;

      const tx = -Math.sin(cam.rotation.elements[1] - 0.42) * 1.5;
      const tz = -Math.cos(cam.rotation.elements[1] - 0.42) * 1.5;

      this.torchParticle.transform.position.elements[0] = x + cam.position.elements[0];
      this.torchParticle.transform.position.elements[1] = cam.position.elements[1] - 0.3;
      this.torchParticle.transform.position.elements[2] = z + cam.position.elements[2];

      this.torch.transform.position.elements[0] = tx + cam.position.elements[0];
      this.torch.transform.position.elements[1] = cam.position.elements[1] - 0.5;
      this.torch.transform.position.elements[2] = tz + cam.position.elements[2];

      this.torch.transform.rotation.elements[1] = cam.rotation.elements[1];

      if (this.myKeys.keydown[80]) {
        this.musicPaused = true;
        this.musicPlayer.pause();
      }
      if (this.myKeys.keydown[79]) {
        this.musicPaused = false;
        this.musicPlayer.resume();
      }
    },

    calculateDeltaTime() {
      let now,
        fps;
      now = performance.now();
      fps = 1000 / (now - this.lastTime);
        // fps = clamp(fps, 12, 60);
      this.lastTime = now;
      return 1 / fps;
    },

    doMousedown(e) {
      const mouse = getMouse(e);

      this.pmouse = mouse;
      this.canvas.requestPointerLock();

      this.resumeGame();
    },

    lockChangeAlert(e) {
      if (document.pointerLockElement === this.canvas || document.mozPointerLockElement === this.canvas) {
        this.resumeGame();
      } else {
          // this.pauseGame();
      }
    },

    pauseGame() {
      if (this.gameState === this.GAME_STATE.DEFAULT) {
        cancelAnimationFrame(this.animationID);
        this.gameState = this.GAME_STATE.PAUSED;
        this.handleKeyPress = false;
        this.update();
        this.musicPlayer.pause();
      }
    },

    resumeGame() {
      if (this.gameState === this.GAME_STATE.BEGIN || this.gameState === this.GAME_STATE.PAUSED) {
        cancelAnimationFrame(this.animationID);
        this.gameState = this.GAME_STATE.DEFAULT;
        this.handleKeyPress = true;
        this.update();
        if (!this.musicPaused) {
          this.musicPlayer.resume();
        }
      }
    },

    getAltitude(period, time, shift) {
      if (period == 0) { return 0.25; }
      let f1 = (time % period) / period - 0.25;

      if (f1 < 0.0) { ++f1; }

      if (f1 > 1.0) { --f1; }

      const f2 = f1;
      f1 = 1.0 - (Math.cos(f1 * Math.PI) + 1.0) / 2.0;
      f1 = f2 + (f1 - f2) / 3.0;
      return f1 + shift / 360.0 + 0.25;
    },

    getSkyColor(altitude) {
      return Math.cos((altitude + 0.5) * Math.PI * 2.0) * 2.0 + 0.5;
    },

    getSkyBlend() {
      const temp = 2.0; // MC "Desert" biome
      const k = Math.max(-1.0, Math.min(1.0, temp / 3.0));
      return $V([0.6222 - k * 0.05, 0.5 + k * 0.1, 1.0]);
    },

    handleSky() {
      const sunAlt = this.getAltitude(this.cycleTime, this.worldTime, 0);
      const moonAlt = this.getAltitude(this.cycleTime, this.worldTime, 180);

      const gradient = Math.max(0, Math.min(1, this.getSkyColor(sunAlt)));
      const skyColor = this.getSkyBlend().multiply(gradient);

      this.graphics.skyColor().elements = skyColor.elements;
      this.graphics.setAmbient(skyColor);

      const camPos = this.graphics.getActiveCamera().transform.position;
      this.drawCelestial(this.sunRender, sunAlt, camPos);
      this.drawCelestial(this.moonRender, moonAlt, camPos);

      this.sun.intensity = $V([0.5, 0.4, 0.4]).multiply(gradient);

      this.worldTime++;
    },

    drawCelestial(obj, altitude, camPos) {
      const a = ((altitude + 0.5) * Math.PI * 2) % (Math.PI * 2);
      obj.transform.position = $V([0, 180, 0]).rotate(a, $L([0, 0, 0], [0, 0, 1])).add(camPos);
    },

    readableTime() {
      const ticks = ((this.worldTime / this.cycleTime) % 1.0) * 1440;
      const theHour = Math.floor(ticks / 60);
      const absHour = Math.abs(theHour);
      const tMinute = Math.floor(ticks % 60);
      const aMinute = Math.abs(tMinute);
      const aMin = (aMinute < 10 ? '0' : '') + aMinute;
      return `${((theHour < 0 || tMinute < 0) ? '-' : '') + absHour}:${aMin}`;
    },

  };
}()
);
