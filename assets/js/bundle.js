"use strict";

/* eslint-env browser */
/* globals createjs */

var app = window.app || {};

app.AudioPlayer = null;

var loadedSounds = {};

// Loads a sound to be played
// @param { string } src - the filepath of the sound to load
// @param { string } id - the id name to use to represent the sound once loaded
function loadSound(src, id) {
  // Don't try to load a sound twice; probably not needed but better safe than sorry
  if (loadedSounds[id]) {
    return;
  }

  createjs.Sound.registerSound(src, id);
  loadedSounds[id] = true;
}

// Creates an AudioPlayer, used to play audio
// Once created, id can be changed freely to any loaded sound
// @param { string } id - id of the sound to play
app.AudioPlayer = function (id) {
  this.id = id;

  this.play = function () {
    this.sound = createjs.Sound.play(id);
  };

  this.pause = function () {
    if (this.sound) {
      this.sound.paused = true;
    }
  };

  this.resume = function () {
    if (this.sound) {
      this.sound.paused = false;
    }
  };
};

app.audio = { loadSound: loadSound };
'use strict';

var app = window.app || {};

// Function constructors as alternatives to make* functions
// see actual create* function for documentation
var MeshRenderable = null;
var ParticleRenderable = null;
var Particle = null;
var PointLight = null;
var DirectionalLight = null;
var PerspectiveCamera = null;
var OrthogonalCamera = null;

// To all ye who dare enter : good luck in there
app.graphics = function () {
  // /////////////
  //           //
  //  PRIVATE  //
  //           //
  // /////////////

  //              //
  //  PROPERTIES  //
  //              //

  // Keep track of the canvases
  var glCanvas = null;
  var txCanvas = null;

  // Context for advanced rendering to the WebGL-canvas
  var gl = null;
  // Context for rendering text to the text-canvas
  var tx = null;

  // Map containing all loaded shaders, indexed with the shader name
  var shaders = {};
  // Map containing all loaded meshes, indexed with the mesh file name
  var meshes = {};
  // Map containing all loaded textures, indexed with the texture file name
  var textures = {};

  // Used to generate the perspective matrix and bring the scene into eye space during rendering
  var activeCamera = null;
  var cameraMatrix = null;
  // This matrix is only the perspective matrix, used to speed up particle rendering
  var perspMatrix = null;
  // This matrix is only the camera's transformation matrix
  var camTransform = null;
  var aspectRatio = 0.0;

  // The list of all renderables currently in the scene to be drawn
  var renderables = [];

  // The list of transparent renderables
  var transparents = [];

  // List of particle systems, which spawn particles
  var particleSystems = [];

  // The list of particles to render
  var particles = [];

  // List of all directional lights
  var directionalLights = [];

  // List of all point lights
  var pointLights = [];

  // Ambient light
  var ambientIntensity = null;

  // The list of all framebuffers used for deferred shading, by name
  var framebuffer = {};

  // The opaque HDR framebuffer
  var opaqueBuffer = {};

  // The transparent HDR framebuffer
  var transparentBuffer = {};

  // Buffer used for particles
  var particleBuffer = {};

  // The final HDR framebuffer
  var hdrBuffer = {};

  // Collection of all used extensions
  var ext = {};

  // Sneaky variable to speed up the process of transitioning between renderables
  var lastDrawnRenderable = null;

  // Organize the texture binding points better. Honestly using a macro enum instead of a simple number was a terrible design decision for OpenGL
  var glTextureBinds = null;

  // Matrix used for fast-transform of posOnly renderables
  var fastMatrix = null;

  // Cheap trick added last-minute to fake a sky color
  var sColor = null;

  //                    //
  //  MATRIX FUNCTIONS  //
  //                    //

  // Creates a matrix which translates by the provided vector
  function translationMatrix(v) {
    var mat = Matrix.I(4);

    mat.elements[0][3] = v.elements[0];
    mat.elements[1][3] = v.elements[1];
    mat.elements[2][3] = v.elements[2];

    return mat;
  }

  // Creates a matrix which scales by the provided vector
  function scaleMatrix(v) {
    return Matrix.Diagonal([v.elements[0], v.elements[1], v.elements[2], 1.0]);
  }

  // Creates a matrix which rotates using the provided vector in <P/Y/R> notation
  function rotationMatrix(v) {
    var rotP = Matrix.RotationX(v.elements[0]);
    var rotY = Matrix.RotationY(v.elements[1]);
    var rotR = Matrix.RotationZ(v.elements[2]);

    rotY = rotY.multiply(rotP);
    rotY = rotY.multiply(rotR);

    promoteMatrix(rotY);

    return rotY;
  }

  // Uses camera data to create the camera's transform/perspective matrix
  function generateCameraMatrix() {
    // Build the transformation matrix in reverse rather than making a call to inverse - this is much faster, although slightly less clean
    var rotP = Matrix.RotationX(activeCamera.transform.rotation.elements[0] * -1);
    var rotY = Matrix.RotationY(activeCamera.transform.rotation.elements[1] * -1);
    var rotR = Matrix.RotationZ(activeCamera.transform.rotation.elements[2] * -1);
    var matT = translationMatrix(activeCamera.transform.position.multiply(-1));

    var matTransform = rotR.multiply(rotP);
    matTransform = matTransform.multiply(rotY);
    promoteMatrix(matTransform);
    matTransform = matTransform.multiply(matT);

    var matPerspective = null;

    if (activeCamera.ctype == 'perspective') {
      // Build the perspective matrix
      var r = Math.tan(activeCamera.fov * 0.5) * activeCamera.znear;
      var x = 2.0 * activeCamera.znear / (2.0 * r * aspectRatio);
      var y = activeCamera.znear / r;
      var z = -(activeCamera.zfar + activeCamera.znear) / (activeCamera.zfar - activeCamera.znear);
      var p = -(2.0 * activeCamera.zfar * activeCamera.znear) / (activeCamera.zfar - activeCamera.znear);

      matPerspective = Matrix.create([[x, 0, 0, 0], [0, y, 0, 0], [0, 0, z, p], [0, 0, -1, 0]]);
    } else {
      var _x = 2.0 / activeCamera.size / aspectRatio;
      var _y = 2.0 / activeCamera.size;
      var _z = 1.0 / activeCamera.zfar;

      matPerspective = Matrix.create([[_x, 0, 0, 0], [0, _y, 0, 0], [0, 0, _z, 0], [0, 0, 0, 1]]);
    }

    perspMatrix = flattenMatrix(matPerspective);
    camTransform = flattenMatrix(matTransform);

    // And finally set the camera matrix accordingly
    cameraMatrix = flattenMatrix(matPerspective.multiply(matTransform));
  }

  // Promotes a 3x3 matrix to a 4x4 matrix - should only be used for rotation matrices
  function promoteMatrix(m) {
    m.elements.push([0.0, 0.0, 0.0, 1.0]);
    m.elements[0].push([0.0]);
    m.elements[1].push([0.0]);
    m.elements[2].push([0.0]);
  }

  // Flatten a matrix into a Float32Array useable by WebGL
  function flattenMatrix(m) {
    return new Float32Array([m.e(1, 1), m.e(2, 1), m.e(3, 1), m.e(4, 1), m.e(1, 2), m.e(2, 2), m.e(3, 2), m.e(4, 2), m.e(1, 3), m.e(2, 3), m.e(3, 3), m.e(4, 3), m.e(1, 4), m.e(2, 4), m.e(3, 4), m.e(4, 4)]);
  }

  //

  // Function used for particle sorting, sorts farthest to nearest
  function particleSort(a, b) {
    var dista = (activeCamera.transform.position.elements[0] - a.position.elements[0]) * (activeCamera.transform.position.elements[0] - a.position.elements[0]);
    dista += (activeCamera.transform.position.elements[1] - a.position.elements[1]) * (activeCamera.transform.position.elements[1] - a.position.elements[1]);
    dista += (activeCamera.transform.position.elements[2] - a.position.elements[2]) * (activeCamera.transform.position.elements[2] - a.position.elements[2]);

    var distb = (activeCamera.transform.position.elements[0] - b.position.elements[0]) * (activeCamera.transform.position.elements[0] - b.position.elements[0]);
    distb += (activeCamera.transform.position.elements[1] - b.position.elements[1]) * (activeCamera.transform.position.elements[1] - b.position.elements[1]);
    distb += (activeCamera.transform.position.elements[2] - b.position.elements[2]) * (activeCamera.transform.position.elements[2] - b.position.elements[2]);

    // Sort the particles farthest to nearest
    return distb - dista;
  }

  //                  //
  //  INITIALIZATION  //
  //                  //

  // Grab all the extensions to be used throughout rendering
  function initExtensions() {
    // Needed to make texture sampling less horrible
    ext.aniso = gl.getExtension('EXT_texture_filter_anisotropic') || gl.getExtension('MOZ_EXT_texture_filter_anisotropic') || gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');

    // Needed to perform proper deferred rendering
    ext.dbuffer = gl.getExtension('WEBGL_draw_buffers');
    ext.dtex = gl.getExtension('WEBGL_depth_texture');
    ext.fpb = gl.getExtension('OES_texture_float');
    ext.hfb = gl.getExtension('OES_texture_half_float');
  }

  // Initializes the framebuffers to use in deferred shading
  function initFramebuffer(x, y) {
    if (framebuffer.textures) {
      freeFramebuffer();
    }
    framebuffer.buffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer.buffer);
    framebuffer.textures = {};

    //  W     W     W    H    H    Y     Y
    //  W     W     W    H    H     Y   Y
    //   W   W W   W     H    H      Y Y
    //   W   W W   W     HHHHHH       Y
    //    W W   W W      H    H       Y
    //    W W   W W      H    H       Y
    //     W     W       H    H       Y
    // Apparently on some systems, and only some systems, float and byte textures can't be in the same framebuffer???

    // Setup the diffuse target
    // R / G / B
    framebuffer.textures.diffuse = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.diffuse);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, gl.FLOAT, null);

    // Setup the normal target
    // X / Y / Z
    framebuffer.textures.normal = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.normal);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, gl.FLOAT, null);

    // Setup the specular target
    // R / G / B / Roughness
    framebuffer.textures.specular = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.specular);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, gl.FLOAT, null);

    // Setup the emission target
    // R / G / B
    framebuffer.textures.emission = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.emission);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, gl.FLOAT, null);

    // Setup the world-position target
    // X / Y / Z
    framebuffer.textures.position = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.position);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, gl.FLOAT, null);

    // Setup the depth target

    framebuffer.textures.depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.depth);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, x, y, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, framebuffer.textures.diffuse, 0);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT1_WEBGL, gl.TEXTURE_2D, framebuffer.textures.normal, 0);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT2_WEBGL, gl.TEXTURE_2D, framebuffer.textures.specular, 0);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT3_WEBGL, gl.TEXTURE_2D, framebuffer.textures.emission, 0);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT4_WEBGL, gl.TEXTURE_2D, framebuffer.textures.position, 0);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, framebuffer.textures.depth, 0);

    opaqueBuffer.buffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, opaqueBuffer.buffer);

    opaqueBuffer.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, opaqueBuffer.texture);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, ext.hfb.HALF_FLOAT_OES, null);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, opaqueBuffer.texture, 0);

    transparentBuffer.buffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, transparentBuffer.buffer);

    transparentBuffer.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, transparentBuffer.texture);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, ext.hfb.HALF_FLOAT_OES, null);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, transparentBuffer.texture, 0);

    hdrBuffer.buffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, hdrBuffer.buffer);

    hdrBuffer.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, hdrBuffer.texture);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, ext.hfb.HALF_FLOAT_OES, null);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, hdrBuffer.texture, 0);

    particleBuffer.buffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, particleBuffer.buffer);

    particleBuffer.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, particleBuffer.texture);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, x, y, 0, gl.RGBA, ext.hfb.HALF_FLOAT_OES, null);

    particleBuffer.depth = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, particleBuffer.depth);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT, x, y, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_SHORT, null);

    gl.framebufferTexture2D(gl.FRAMEBUFFER, ext.dbuffer.COLOR_ATTACHMENT0_WEBGL, gl.TEXTURE_2D, particleBuffer.texture, 0);
  }

  function initLightShaders() {
    // Setup that ambient light
    // AHAHAA I'M APPLYING THE AMBIENT LIGHT TO THE BACKGROUND?? I'll fix it later
    ambientIntensity = new Float32Array([0.5, 0.46, 0.42, 1.0]);

    // Vertex Shader - shared across all lights
    var vShaderSource = app.shaders.lightVertex;
    var vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vShaderSource);
    gl.compileShader(vShader);

    // Lighting prepass fragment shader
    var prepassSource = app.shaders.lightPrepass;
    var prepass = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(prepass, prepassSource);
    gl.compileShader(prepass);
    var prepassShader = gl.createProgram();
    gl.attachShader(prepassShader, vShader);
    gl.attachShader(prepassShader, prepass);
    gl.linkProgram(prepassShader);
    gl.useProgram(prepassShader);
    shaders.lightPrepass = {
      shader: prepassShader,
      vpos: gl.getAttribLocation(prepassShader, 'vpos'),
      emission: gl.getUniformLocation(prepassShader, 'emission')
    };

    // Ambient light fragment shader
    var ambientSource = app.shaders.lightAmbient;
    var ambient = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(ambient, ambientSource);
    gl.compileShader(ambient);
    var ambientShader = gl.createProgram();
    gl.attachShader(ambientShader, vShader);
    gl.attachShader(ambientShader, ambient);
    gl.linkProgram(ambientShader);
    gl.useProgram(ambientShader);
    shaders.lightAmbient = {
      shader: ambientShader,
      vpos: gl.getAttribLocation(ambientShader, 'vpos'),
      diffuse: gl.getUniformLocation(ambientShader, 'diffuse'),
      intensity: gl.getUniformLocation(ambientShader, 'intensity')
    };

    // Directional light fragment shader
    var directionalSource = app.shaders.lightDirectional;
    var directional = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(directional, directionalSource);
    gl.compileShader(directional);
    var directionalShader = gl.createProgram();
    gl.attachShader(directionalShader, vShader);
    gl.attachShader(directionalShader, directional);
    gl.linkProgram(directionalShader);

    gl.useProgram(directionalShader);
    shaders.lightDirectional = {
      shader: directionalShader,
      vpos: gl.getAttribLocation(directionalShader, 'vpos'),
      diffuse: gl.getUniformLocation(directionalShader, 'diffuse'),
      normal: gl.getUniformLocation(directionalShader, 'normal'),
      specular: gl.getUniformLocation(directionalShader, 'specular'),
      position: gl.getUniformLocation(directionalShader, 'position'),
      direction: gl.getUniformLocation(directionalShader, 'direction'),
      intensity: gl.getUniformLocation(directionalShader, 'intensity'),
      camPos: gl.getUniformLocation(directionalShader, 'camPos')
    };

    // Point light fragment shader
    var pointSource = app.shaders.lightPoint;
    var point = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(point, pointSource);
    gl.compileShader(point);
    var pointShader = gl.createProgram();
    gl.attachShader(pointShader, vShader);
    gl.attachShader(pointShader, point);
    gl.linkProgram(pointShader);

    gl.useProgram(pointShader);
    shaders.lightPoint = {
      shader: pointShader,
      vpos: gl.getAttribLocation(pointShader, 'vpos'),
      diffuse: gl.getUniformLocation(pointShader, 'diffuse'),
      normal: gl.getUniformLocation(pointShader, 'normal'),
      specular: gl.getUniformLocation(pointShader, 'specular'),
      position: gl.getUniformLocation(pointShader, 'position'),
      lightPos: gl.getUniformLocation(pointShader, 'lightPos'),
      intensity: gl.getUniformLocation(pointShader, 'intensity'),
      camPos: gl.getUniformLocation(pointShader, 'camPos'),
      radius: gl.getUniformLocation(pointShader, 'radius')
    };

    console.log('compilation error : ' + gl.getShaderInfoLog(point));

    // Fusion pass fragment shader
    var fusionSource = app.shaders.fusionFS;
    var fusion = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fusion, fusionSource);
    gl.compileShader(fusion);
    var fusionShader = gl.createProgram();
    gl.attachShader(fusionShader, vShader);
    gl.attachShader(fusionShader, fusion);
    gl.linkProgram(fusionShader);

    gl.useProgram(fusionShader);
    shaders.fusion = {
      shader: fusionShader,
      vpos: gl.getAttribLocation(fusionShader, 'vpos'),
      diffuse: gl.getUniformLocation(fusionShader, 'diffuse'),
      opaque: gl.getUniformLocation(fusionShader, 'opaque'),
      transparent: gl.getUniformLocation(fusionShader, 'transparent'),
      particle: gl.getUniformLocation(fusionShader, 'particle'),
      sColor: gl.getUniformLocation(fusionShader, 'skyColor')
    };

    // HDR final pass fragment shader
    var hdrSource = app.shaders.hdrFS;
    var hdr = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(hdr, hdrSource);
    gl.compileShader(hdr);
    var hdrShader = gl.createProgram();
    gl.attachShader(hdrShader, vShader);
    gl.attachShader(hdrShader, hdr);
    gl.linkProgram(hdrShader);

    gl.useProgram(hdrShader);
    shaders.hdr = {
      shader: hdrShader,
      vpos: gl.getAttribLocation(hdrShader, 'vpos'),
      tex: gl.getUniformLocation(hdrShader, 'tex')
    };

    // Vertex Shader for particles
    var particleVSSource = app.shaders.particleVS;
    var particleVS = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(particleVS, particleVSSource);
    gl.compileShader(particleVS);

    // Particle fragment shader
    var particleFSSource = app.shaders.particleFS;
    var particleFS = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(particleFS, particleFSSource);
    gl.compileShader(particleFS);
    var particleShader = gl.createProgram();
    gl.attachShader(particleShader, particleVS);
    gl.attachShader(particleShader, particleFS);
    gl.linkProgram(particleShader);

    gl.useProgram(particleShader);
    shaders.particle = {
      shader: particleShader,
      vpos: gl.getAttribLocation(particleShader, 'vpos'),
      cam: gl.getUniformLocation(particleShader, 'cam'),
      persp: gl.getUniformLocation(particleShader, 'persp'),
      pos: gl.getUniformLocation(particleShader, 'pos'),
      scale: gl.getUniformLocation(particleShader, 'scale'),
      texture: gl.getUniformLocation(particleShader, 'texture'),
      oldPos: gl.getUniformLocation(particleShader, 'oldPos'),
      camPos: gl.getUniformLocation(particleShader, 'camPos'),
      screenSize: gl.getUniformLocation(particleShader, 'screenSize')
    };
  }

  //                 //
  //  ASSET RELEASE  //
  //                 //

  // Frees the textures used in the framebuffer
  function freeFramebuffer() {
    gl.deleteTexture(framebuffer.textures.diffuse);
    gl.deleteTexture(framebuffer.textures.normal);
    gl.deleteTexture(framebuffer.textures.specular);
    gl.deleteTexture(framebuffer.textures.emission);
    gl.deleteTexture(framebuffer.textures.position);
    gl.deleteTexture(framebuffer.textures.depth);
    gl.deleteFramebuffer(framebuffer.buffer);

    gl.deleteTexture(opaqueBuffer.texture);
    gl.deleteFramebuffer(opaqueBuffer.buffer);

    gl.deleteTexture(transparentBuffer.texture);
    gl.deleteFramebuffer(transparentBuffer.buffer);

    gl.deleteTexture(hdrBuffer.texture);
    gl.deleteFramebuffer(hdrBuffer.buffer);
  }

  // Frees the requested mesh
  // @param { string } mesh - filepath of the mesh to free
  function freeMesh(mesh) {
    gl.deleteBuffer(meshes[mesh].buffer);
  }

  // Frees the requested texture
  // @param { string } texture - filepath of the texture to free
  function freeTexture(texture) {
    gl.deleteTexture(textures[texture]);
  }

  // Frees the requested material
  // @param { string } material - name (filepath) of the material to free
  function freeMaterial(material) {
    gl.deleteProgram(shaders[material].shader);
  }

  //             //
  //  SHADER IO  //
  //             //

  // Load and initialize all resources to be used
  // ONLY TO BE CALLED ONCE BY init
  function initResources() {
    initMaterial(app.shaders.defaultMaterial, 'defaultMaterial');

    loadMesh('assets/meshes/cube.obj');
    loadMesh('assets/meshes/screenQuad.obj');
    loadMesh('assets/meshes/quad.obj');

    loadTexture('assets/textures/defaultDiffuse.png');
    loadTexture('assets/textures/defaultNormal.png');
    loadTexture('assets/textures/defaultTex.png');
    loadTexture('assets/textures/nothing.png');

    loadTexture('assets/textures/particleSmoke.png');
    loadTexture('assets/textures/particleFire1.png');
    loadTexture('assets/textures/particleFire2.png');

    initLightShaders();
  }

  //           //
  //  DRAWING  //
  //           //

  // Called to draw a mesh renderable
  // ONLY TO BE CALLED BY draw
  function drawMesh(renderable) {
    gl.bindBuffer(gl.ARRAY_BUFFER, meshes[renderable.mesh].buffer);
    var v = meshes[renderable.mesh].count;
    var shader = shaders[renderable.material.shader];

    gl.useProgram(shader.shader);

    if (lastDrawnRenderable) {
      gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vpos);
      gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vtex);
      gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vnor);
    }

    gl.enableVertexAttribArray(shader.vpos);
    gl.enableVertexAttribArray(shader.vtex);
    gl.enableVertexAttribArray(shader.vnor);

    // Set the attribute values
    gl.vertexAttribPointer(shader.vpos, 3, gl.FLOAT, false, 0, 0);
    gl.vertexAttribPointer(shader.vtex, 2, gl.FLOAT, false, 0, v * 12);
    gl.vertexAttribPointer(shader.vnor, 3, gl.FLOAT, false, 0, v * 20);

    var pmat = cameraMatrix;
    var wmat = fastMatrix;

    if (renderable.posOnly) {
      wmat[12] = renderable.transform.position.elements[0];
      wmat[13] = renderable.transform.position.elements[1];
      wmat[14] = renderable.transform.position.elements[2];
    } else {
      wmat = translationMatrix(renderable.transform.position);
      wmat = wmat.multiply(rotationMatrix(renderable.transform.rotation));
      wmat = wmat.multiply(scaleMatrix(renderable.transform.scale));
      wmat = flattenMatrix(wmat);
    }

    // Set the matrix uniforms
    gl.uniformMatrix4fv(shader.puni, false, pmat);
    gl.uniformMatrix4fv(shader.wuni, false, wmat);

    gl.uniform4f(gl.getUniformLocation(shader.shader, 'camPos'), activeCamera.transform.position.elements[0], activeCamera.transform.position.elements[1], activeCamera.transform.position.elements[2], activeCamera.transform.position.elements[3]);

    // Texture

    // Set material uniforms
    for (var i = 0; i < renderable.material.textures.length; ++i) {
      if (renderable.material.textures[i].uni) {
        gl.activeTexture(glTextureBinds[i]);
        gl.bindTexture(gl.TEXTURE_2D, textures[renderable.material.textures[i].val]);

        gl.uniform1i(renderable.material.textures[i].uni, i);
      }
    }

    // Set vector uniforms
    for (var _i = 0; _i < renderable.material.vectors.length; ++_i) {
      if (renderable.material.vectors[_i].uni) {
        gl.uniform4f(renderable.material.vectors[_i].uni, renderable.material.vectors[_i].val.elements[0], renderable.material.vectors[_i].val.elements[1], renderable.material.vectors[_i].val.elements[2], renderable.material.vectors[_i].val.elements[3]);
      }
    }

    // Set float uniforms
    for (var _i2 = 0; _i2 < renderable.material.floats.length; ++_i2) {
      if (renderable.material.floats[_i2].uni) {
        gl.uniform1f(renderable.material.floats[_i2].uni, renderable.material.floats[_i2].val);
      }
    }

    // ext.dbuffer.drawBuffersWEBGL([gl.BACK]);
    // gl.drawArrays(gl.TRIANGLES, 0, v);

    ext.dbuffer.drawBuffersWEBGL([ext.dbuffer.COLOR_ATTACHMENT0_WEBGL, ext.dbuffer.COLOR_ATTACHMENT1_WEBGL, ext.dbuffer.COLOR_ATTACHMENT2_WEBGL, ext.dbuffer.COLOR_ATTACHMENT3_WEBGL, ext.dbuffer.COLOR_ATTACHMENT4_WEBGL]);
    gl.drawArrays(gl.TRIANGLES, 0, v);
  }

  // Called to draw a particle renderable
  // Once deferred shading is implemented, this will have to happen only after all the mesh renderables are done being drawn, as particles will use optimized forward shading
  // ONLY TO BE CALLED BY draw
  // TODO : Implement
  function drawParticles(index) {
    // gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vpos);
    gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vtex);
    gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vnor);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshes['assets/meshes/screenQuad.obj'].buffer);

    gl.useProgram(shaders.particle.shader);
    gl.enableVertexAttribArray(shaders.particle.vpos);
    gl.vertexAttribPointer(shaders.particle.vpos, 3, gl.FLOAT, false, 0, 0);

    gl.uniformMatrix4fv(shaders.particle.cam, false, camTransform);
    gl.uniformMatrix4fv(shaders.particle.persp, false, perspMatrix);

    gl.uniform3f(shaders.particle.camPos, activeCamera.transform.position.elements[0], activeCamera.transform.position.elements[1], activeCamera.transform.position.elements[2]);

    gl.uniform2f(shaders.particle.screenSize, glCanvas.width, glCanvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.position);
    gl.uniform1i(shaders.particle.oldPos, 0);

    // And draw the particles
    for (var i = 0; i < particles.length; ++i) {
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, textures[particles[i].texture]);
      gl.uniform1i(shaders.particle.texture, 1);

      gl.uniform4f(shaders.particle.pos, particles[i].position.elements[0], particles[i].position.elements[1], particles[i].position.elements[2], 1.0);

      gl.uniform2f(shaders.particle.scale, particles[i].scale.elements[0], particles[i].scale.elements[1]);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }

  // Called by draw once all meshes have been drawn to the framebuffer
  // ONLY TO BE CALLED BY draw
  function drawShadingPass() {
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vpos);
    gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vtex);
    gl.disableVertexAttribArray(shaders[lastDrawnRenderable.material.shader].vnor);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshes['assets/meshes/screenQuad.obj'].buffer);

    gl.useProgram(shaders.lightPrepass.shader);
    gl.enableVertexAttribArray(shaders.lightPrepass.vpos);
    gl.vertexAttribPointer(shaders.lightPrepass.vpos, 3, gl.FLOAT, false, 0, 0);

    // PREPASS

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.emission);
    gl.uniform1i(shaders.lightPrepass.emission, 0);
    gl.uniform4fv(shaders.lightPrepass.intensity, ambientIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // AMBIENT

    gl.useProgram(shaders.lightAmbient.shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.diffuse);
    gl.uniform1i(shaders.lightAmbient.diffuse, 0);
    gl.uniform4fv(shaders.lightAmbient.intensity, ambientIntensity);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    // DIRECTIONAL

    gl.useProgram(shaders.lightDirectional.shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.diffuse);
    gl.uniform1i(shaders.lightDirectional.diffuse, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.normal);
    gl.uniform1i(shaders.lightDirectional.normal, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.specular);
    gl.uniform1i(shaders.lightDirectional.specular, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.position);
    gl.uniform1i(shaders.lightDirectional.position, 3);

    // gl.uniform4fv(shaders.lightDirectional.intensity, ambientIntensity);

    for (var i = 0; i < directionalLights.length; ++i) {
      gl.uniform4f(shaders.lightDirectional.direction, directionalLights[i].direction.elements[0] || 0.0, directionalLights[i].direction.elements[1] || -1.0, directionalLights[i].direction.elements[2] || 0.0, 0.0);

      gl.uniform4f(shaders.lightDirectional.intensity, directionalLights[i].intensity.elements[0] || 0.5, directionalLights[i].intensity.elements[1] || 0.5, directionalLights[i].intensity.elements[2] || 0.5, 1.0);

      gl.uniform4f(shaders.lightDirectional.camPos, activeCamera.transform.position.elements[0] || 0.0, activeCamera.transform.position.elements[1] || 0.0, activeCamera.transform.position.elements[2] || 0.0, 1.0);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    // POINT

    gl.useProgram(shaders.lightPoint.shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.diffuse);
    gl.uniform1i(shaders.lightPoint.diffuse, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.normal);
    gl.uniform1i(shaders.lightPoint.normal, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.specular);
    gl.uniform1i(shaders.lightPoint.specular, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.position);
    gl.uniform1i(shaders.lightPoint.position, 3);

    for (var _i3 = 0; _i3 < pointLights.length; ++_i3) {
      gl.uniform4f(shaders.lightPoint.lightPos, pointLights[_i3].position.elements[0] || 0.0, pointLights[_i3].position.elements[1] || 0.0, pointLights[_i3].position.elements[2] || 0.0, 1.0);

      gl.uniform4f(shaders.lightPoint.intensity, pointLights[_i3].intensity.elements[0] || 0.5, pointLights[_i3].intensity.elements[1] || 0.5, pointLights[_i3].intensity.elements[2] || 0.5, 1.0);

      gl.uniform4f(shaders.lightPoint.camPos, activeCamera.transform.position.elements[0] || 0.0, activeCamera.transform.position.elements[1] || 0.0, activeCamera.transform.position.elements[2] || 0.0, 1.0);

      gl.uniform1f(shaders.lightPoint.radius, pointLights[_i3].radius);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
  }

  // Fuses the opaque and transparent framebuffers
  function drawFusionPass() {
    gl.disable(gl.DEPTH_TEST);

    gl.useProgram(shaders.fusion.shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, opaqueBuffer.texture);
    gl.uniform1i(shaders.fusion.opaque, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, transparentBuffer.texture);
    gl.uniform1i(shaders.fusion.transparent, 1);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.diffuse);
    gl.uniform1i(shaders.fusion.diffuse, 2);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, particleBuffer.texture);
    gl.uniform1i(shaders.fusion.particle, 3);

    gl.uniform3f(shaders.fusion.sColor, sColor.elements[0], sColor.elements[1], sColor.elements[2], 1.0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // Computes HDR effects and puts everything on the screen
  function drawFinalPass() {
    gl.useProgram(shaders.hdr.shader);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, hdrBuffer.texture);
    gl.uniform1i(shaders.hdr.tex, 0);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  // ////////////
  //          //
  //  PUBLIC  //
  //          //
  // ////////////

  //        //
  //  CORE  //
  //        //

  // Initialize the rendering engine, sizes the canvases used to the requested size
  function init(x, y) {
    // Fetch both canvases
    glCanvas = document.querySelector('#glCanvas');
    txCanvas = document.querySelector('#txCanvas');

    // Attempt to initalize the WebGL context, will abort if this fails
    gl = glCanvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      /* console.log("WebGL failed to initialize.");*/return;
    }

    // Grab all the needed extensions
    initExtensions();

    sColor = $V([0.4, 0.6, 0.8]);

    glTextureBinds = [gl.TEXTURE0, gl.TEXTURE1, gl.TEXTURE2, gl.TEXTURE3, gl.TEXTURE4, gl.TEXTURE5, gl.TEXTURE6, gl.TEXTURE7, gl.TEXTURE8, gl.TEXTURE9, gl.TEXTURE10, gl.TEXTURE11, gl.TEXTURE12, gl.TEXTURE13, gl.TEXTURE14, gl.TEXTURE15];

    // Initialize the text canvas
    tx = txCanvas.getContext('2d');

    // Give the camera default spawn properties
    activeCamera = createPerspectiveCamera({});

    // Setup rendering canvases and viewport
    resize(x, y);

    // Initialize resources
    initResources();

    fastMatrix = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

    gl.clearColor(0.06, 0.06, 0.12, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    // Why is FRONT_AND_BACK an option.
    gl.cullFace(gl.BACK);
    clear();
  }

  // Clears the text canvas
  function clear() {
    // gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    tx.clearRect(0, 0, txCanvas.width, txCanvas.height);

    // gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer.buffer);
    // gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    generateCameraMatrix();
  }

  // Updates the size of the canvases and viewport to match the requested size
  // @param { number } x - the width in pixels
  // @param { number } y - the height in pixels
  function resize(x, y) {
    // Set the starting widths and heights of the canvases
    glCanvas.width = x;
    glCanvas.height = y;
    txCanvas.width = x;
    txCanvas.height = y;

    // Set the WebGL viewport
    gl.viewport(0, 0, glCanvas.width, glCanvas.height);

    aspectRatio = x / y;

    initFramebuffer(x, y);
  }

  // Renders the entire scene once
  function draw(dt) {
    // Setup for rendering
    generateCameraMatrix();
    lastDrawnRenderable = null;

    // Update all the particle systems
    for (var i = 0; i < particleSystems.length; ++i) {
      var part = particleSystems[i].spawn(dt);

      if (part) {
        part.position = part.position.add(particleSystems[i].transform.position);

        particles.push(part);
      }
    }

    // Update all particles
    for (var _i4 = 0; _i4 < particles.length; ++_i4) {
      particles[_i4].velocity.elements[0] += particles[_i4].accel.elements[0] * dt;
      particles[_i4].velocity.elements[1] += particles[_i4].accel.elements[1] * dt;
      particles[_i4].velocity.elements[2] += particles[_i4].accel.elements[2] * dt;

      particles[_i4].position.elements[0] += particles[_i4].velocity.elements[0] * dt;
      particles[_i4].position.elements[1] += particles[_i4].velocity.elements[1] * dt;
      particles[_i4].position.elements[2] += particles[_i4].velocity.elements[2] * dt;
    }

    // Sort the particles
    particles.sort(particleSort);

    // Remove dead particles
    for (var _i5 = particles.length - 1; _i5 >= 0; --_i5) {
      particles[_i5].time += dt;

      if (particles[_i5].time > particles[_i5].life) {
        particles.splice(_i5, 1);
      }
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);

    // Bind the framebuffer for the first rendering pass
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer.buffer);

    // Clear the framebuffer before drawing
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    tx.clearRect(0, 0, txCanvas.width, txCanvas.height);

    for (var _i6 = 0; _i6 < renderables.length; ++_i6) {
      drawMesh(renderables[_i6]);
      lastDrawnRenderable = renderables[_i6];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, opaqueBuffer.buffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawShadingPass();

    // Draw the particles
    gl.bindFramebuffer(gl.FRAMEBUFFER, particleBuffer.buffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawParticles();

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer.buffer);
    gl.disable(gl.BLEND);
    // gl.blendFunc(gl.ONE, gl.ZERO);
    gl.clear(gl.COLOR_BUFFER_BIT);

    for (var _i7 = 0; _i7 < transparents.length; ++_i7) {
      drawMesh(transparents[_i7]);
      lastDrawnRenderable = transparents[_i7];
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, transparentBuffer.buffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawShadingPass();

    gl.bindFramebuffer(gl.FRAMEBUFFER, hdrBuffer.buffer);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawFusionPass();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    drawFinalPass();
  }

  // Draws a string of text at the specified position and with the specified properties
  // @param { string } string - the text to be drawn
  // @param { number } x - the starting x-position in pixels for the text
  // @param { number } y - the starting y-position in pixels for the text
  // @param { string } css - the css controlling font-size font-face, etc.
  // @param { string } color - the css color to render the text in
  function drawText(string, x, y, css, color) {
    tx.font = css;
    tx.fillStyle = color;
    tx.fillText(string, x, y);
  }

  //                        //
  //  RENDERABLES & LIGHTS  //
  //                        //

  // Returns an object representing a 3d mesh to be rendered by the rendering engine
  // After creation, the position, rotation, and scale can be freely modified as properties of its transform property (renderable.transform.*)
  // Changing other properties after creation may produce undefined behavior
  //
  // @param { object } descriptor - optional keys to initialize the renderable
  /*
  	* position : a vector representing the starting position
  	* rotation : a vector representing the starting rotation in P/Y/R euler angle format
  	* scale    : a vector representing the starting scale of each axis
  	* mesh     : a string representing the name of the mesh to use
  	* shader   : a string representing the name of the shader to use
  	* posOnly  : a bool claiming that the object will only ever translate; allows for aggressive optimizations
  	* opaque   : a bool denoting whether the object is truly opaque or semi-transparent
  	* textures : an object { uniformName : texture(string), ... } denoting material textures
  	* vectors  : an object { uniformName : vector(Vector), ... } denoting material vectors
  	* floats   : an object { uniformName : float(number), ... } denoting material floats
  	* diffuse  : DEPRECATED - a string representing the name of the diffuse texture to use
  	* normal   : DEPRECATED - a string representing the name of the normal texture to use
  */
  function createMeshRenderable(descriptor) {
    return new MeshRenderable(descriptor);
  }
  MeshRenderable = function MeshRenderable(descriptor) {
    // Give the renderable its own transform to be manipulated by the game and used in rendering
    this.transform = {
      position: descriptor.position || Vector.create([0, 0, 0]),
      rotation: descriptor.rotation || Vector.create([0, 0, 0]),
      scale: descriptor.scale || Vector.create([1, 1, 1])
    };

    this.posOnly = descriptor.posOnly || false;
    this.opaque = descriptor.opaque !== false;

    // Name of the mesh; will be mapped to the actual mesh within the rendering engine later
    this.mesh = descriptor.mesh || 'assets/meshes/cube.obj';

    // The material will contain the shader to use, associated textures, and possibly more
    this.material = {
      shader: descriptor.shader || 'defaultMaterial',
      textures: [],
      vectors: [],
      floats: [],
      texLocs: {},
      vecLocs: {},
      floLocs: {}
    };

    // Object-oriented functionality!
    this.register = function () {
      registerRenderable(this);
    };
    this.unregister = function () {
      unregisterRenderable(this);
    };

    // Setting and getting uniform "material properties"

    // Sets the requested texture uniform in the material to the provided texture - returns true if successful
    // @param { string } uniform - name of the uniform in the material
    // @param { string } texture - name of the texture (file path) to set
    this.setTexture = function (uniform, texture) {
      // If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].txUnis)) {
        return false;
      }

      var uni = shaders[this.material.shader].txUnis[uniform];

      if (uniform in this.material.texLocs) {
        this.material.textures[this.material.texLocs[uniform]] = { uni: uni, val: texture };
      } else {
        this.material.texLocs[uniform] = this.material.textures.length;
        this.material.textures.push({ uni: uni, val: texture });
      }

      return true;
    };

    // Gets the texture currently set as the provided material texture
    // @param { string } uniform - name of the uniform in the material
    this.getTexture = function (uniform) {
      // If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].txUnis)) {
        return null;
      }

      return this.material.textures[this.material.texLocs[uniform]];
    };

    // Sets the requested vector uniform in the material to the provided vector - returns true if successful
    // @param { string } uniform - name of the uniform in the material
    // @param { Vector } vector - vector to set
    this.setVector = function (uniform, vector) {
      // If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].v4Unis)) {
        return false;
      }

      var uni = shaders[this.material.shader].v4Unis[uniform];
      var vec = Vector.create([vector.elements[0] || 0.0, vector.elements[1] || 0.0, vector.elements[2] || 0.0, vector.elements[3] || 0.0]);

      if (uniform in this.material.vecLocs) {
        this.material.vectors[this.material.vecLocs[uniform]] = { uni: uni, val: vec };
      } else {
        this.material.vecLocs[uniform] = this.material.vectors.length;
        this.material.vectors.push({ uni: uni, val: vec });
      }

      return true;
    };

    // Gets the vector currently set as the provided material vector
    // @param { string } uniform - name of the uniform in the material
    this.getVector = function (uniform) {
      // If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].v4Unis)) {
        return null;
      }

      return this.material.vectors[this.material.vecLocs[uniform]];
    };

    // Sets the requested float uniform in the material to the provided float - returns true if successful
    // @param { string } uniform - name of the uniform in the material
    // @param { number } float - float to set
    this.setFloat = function (uniform, float) {
      // If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].flUnis)) {
        return false;
      }

      var uni = shaders[this.material.shader].flUnis[uniform];

      if (uniform in this.material.floLocs) {
        this.material.floats[this.material.floLocs[uniform]] = { uni: uni, val: float };
      } else {
        this.material.floLocs[uniform] = this.material.floats.length;
        this.material.floats.push({ uni: uni, val: float });
      }

      return true;
    };

    // Gets the float currently set as the provided material float
    // @param { string } uniform - name of the uniform in the material
    this.getFloat = function (uniform, float) {
      // If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].flUnis)) {
        return null;
      }

      return this.material.floats[this.material.floLocs[uniform]];
    };

    for (var i = 0; i < shaders[this.material.shader].txs.length; ++i) {
      var tex = 'assets/textures/nothing.png';
      if (descriptor.textures) {
        tex = descriptor.textures[shaders[this.material.shader].txs[i]] || tex;
      }
      this.setTexture(shaders[this.material.shader].txs[i], tex);
    }

    for (var _i8 = 0; _i8 < shaders[this.material.shader].v4s.length; ++_i8) {
      var vec = Vector.create([0.0, 0.0, 0.0, 0.0]);
      if (descriptor.vectors) {
        vec = descriptor.vectors[shaders[this.material.shader].v4s[_i8]] || vec;
      }
      this.setVector(shaders[this.material.shader].v4s[_i8], vec);
    }

    for (var _i9 = 0; _i9 < shaders[this.material.shader].fls.length; ++_i9) {
      var float = 0.0;
      if (descriptor.floats) {
        float = descriptor.floats[shaders[this.material.shader].fls[_i9]] || float;
      }
      this.setFloat(shaders[this.material.shader].fls[_i9], float);
    }

    // Specify that the type of renderable is mesh, as draw will accept either type
    this.rtype = 'mesh';
    // Give the renderable a self-aware index reference to make registering and unregistering renderables more efficient
    this.rindex = -1;
  };

  // Creates a particle system, which spawns particles for rendering
  // Like other renderables, position can be manipulated through transform
  // @param { object } descriptor - a map of keys with optional values for construction
  /*
  	* position : the starting position Vector
  	* spawn    : a function taking a parameter dt, which returns a particle or null if no particles were spawned during the call
  */
  ParticleRenderable = function ParticleRenderable(descriptor) {
    this.transform = {};
    this.transform.position = descriptor.position || $V([0.0, 0.0, 0.0]);

    this.timeToSpawn = 0.25;

    this.spawn = descriptor.spawn || function (dt) {
      this.timeToSpawn -= dt;

      if (this.timeToSpawn <= 0.0) {
        this.timeToSpawn = Math.random() / 10.0 + 0.1;

        var texChance = Math.random();
        var texString = '';

        if (texChance < 0.34) {
          texString = 'assets/textures/particleSmoke.png';
        } else if (texChance < 0.67) {
          texString = 'assets/textures/particleFire1.png';
        } else {
          texString = 'assets/textures/particleFire2.png';
        }

        return new Particle({
          position: $V([Math.random() / 16.0 - 0.0625, Math.random() / 16.0 - 0.0625, Math.random() / 16.0 - 0.0625]),
          velocity: $V([Math.random() / 16.0 - 0.0625, Math.random() / 16.0 + 0.0625, Math.random() / 16.0 - 0.0625]),
          accel: $V([0.0, 0.25, 0.0]),
          scale: $V([0.2, 0.2, 0.2]),
          life: Math.random() + 1.0,
          texture: texString
        });
      }

      return null;
    };

    // Object-oriented functionality!
    this.register = function () {
      registerRenderable(this);
    };
    this.unregister = function () {
      unregisterRenderable(this);
    };

    this.rtype = 'particle';
    this.rindex = -1;
  };
  function createParticleRenderable(descriptor) {
    return new ParticleRenderable(descriptor);
  }

  // Creates a particle
  // @param { object } descriptor - a map of keys with optional values for construction
  /*
  	* position : the starting position Vector, relative to the spawner
  	* scale    : the Vector size
  	* texture  : the texture to be used by the particle
  	* velocity : the direction and rate at which the particle travels over time
  	* accel    : the change in velocity over time
  	* life     : the time in seconds the particle will last
  */
  Particle = function Particle(descriptor) {
    this.position = descriptor.position || $V([0.0, 0.0, 0.0]);
    this.scale = descriptor.scale || $V([1.0, 1.0, 1.0]);
    this.texture = descriptor.texture || 'assets/textures/nothing.png';
    this.velocity = descriptor.velocity || $V([0.0, 0.0, 0.0]);
    this.accel = descriptor.accel || $V([0.0, 0.0, 0.0]);
    this.life = descriptor.life || 1.0;
    this.time = 0.0;
  };

  // Returns an object representing a light to be rendered by the rendering engine
  // After creation, the position, intensity, and radius can be freely modified as properties
  //
  // @param { object } descriptor - optional keys to initialize the light
  /*
    * position : A Vector (unit) representing the position of the light
    * intensity : A Vector representing the color of the light
    * radius : A float representing the effective radius of the light
  */
  function createPointLight(descriptor) {
    return new PointLight(descriptor);
  }
  PointLight = function PointLight(descriptor) {
    this.position = descriptor.position || $V([0.0, 0.0, 0.0]);
    this.intensity = descriptor.intensity || $V([0.5, 0.5, 0.5]);
    this.radius = descriptor.radius || 10.0;

    this.register = function () {
      registerLight(this);
    };
    this.unregister = function () {
      unregisterLight(this);
    };

    this.ltype = 'point';
    this.lindex = -1;
  };

  // Returns an object representing a light to be rendered by the rendering engine
  // After creation, the direction and intensity can be freely modified as properties
  //
  // @param { object } descriptor - optional keys to initialize the light
  /*
  	* direction : A Vector (unit) representing the direction of the light
  	* intensity : A Vector representing the color of the light
  */
  function createDirectionalLight(descriptor) {
    return new DirectionalLight(descriptor);
  }
  DirectionalLight = function DirectionalLight(descriptor) {
    this.direction = descriptor.direction || $V([0.0, -1.0, 0.0]);
    this.intensity = descriptor.intensity || $V([0.5, 0.5, 0.5]);

    this.register = function () {
      registerLight(this);
    };
    this.unregister = function () {
      unregisterLight(this);
    };

    this.ltype = 'directional';
    this.lindex = -1;
  };

  // Registers a renderable to be drawn every frame until unregistered
  function registerRenderable(renderable) {
    // Abort if it is already registered
    if (renderable.rindex != -1) {
      return;
    }

    if (renderable.rtype == 'mesh' && renderable.opaque) {
      renderable.rindex = renderables.length;
      renderables.push(renderable);
    } else if (renderable.rtype == 'mesh') {
      renderable.rindex = transparents.length;
      transparents.push(renderable);
    } else {
      renderable.rindex = particleSystems.length;
      particleSystems.push(renderable);
    }
  }

  // Removes a renderable from the list to be rendered every frame
  function unregisterRenderable(renderable) {
    // Just to be safe
    if (renderable.rindex == -1) {
      return;
    }

    if (renderable.opaque) {
      renderables[renderable.rindex] = renderables.pop();
      renderable.rindex = -1;
    } else {
      transparents[renderable.rindex] = transparents.pop();
      renderable.rindex = -1;
    }
  }

  // Registers a light to be drawn every frame until unregistered
  function registerLight(light) {
    // Abort if it is already registered
    if (light.lindex != -1) {
      return;
    }

    switch (light.ltype) {
      case 'directional':
        light.lindex = directionalLights.length;
        directionalLights.push(light);
        break;
      case 'point':
        light.lindex = pointLights.length;
        pointLights.push(light);
        break;
    }
  }

  // Removes a light from the list to be rendered every frame
  function unregisterLight(light) {
    // Just to be safe
    if (light.lindex == -1) {
      return;
    }

    switch (light.ltype) {
      case 'directional':
        directionalLights[light.lindex] = directionalLights.pop();
        light.lindex = -1;
        break;
      case 'point':
        pointLights[light.lindex] = pointLights.pop();
        light.lindex = -1;
        break;
    }
  }

  // Controls for ambient lighting, use Vectors
  function getAmbient() {
    return $V([ambientIntensity[0], ambientIntensity[1], ambientIntensity[2]]);
  }
  function setAmbient(intensity) {
    ambientIntensity[0] = intensity.elements[0] || ambientIntensity[0];
    ambientIntensity[1] = intensity.elements[1] || ambientIntensity[1];
    ambientIntensity[2] = intensity.elements[2] || ambientIntensity[2];
  }

  //          //
  //  CAMERA  //
  //          //

  // Returns an object representing a perspective camera to be used as the perspective for rendering
  // After creation, the position and rotation can be freely modified as properties of its transform property (camera.transform.*), as well as the fov property (camera.fov), znear (camera.znear), and zfar (camera.zfar)
  // Scale does not exist for cameras, as it would honestly make no sense
  //
  // @param { object } descriptor - an object filled with a number of optional keys
  /*
  	* position : a vector representing the position
  	* rotation : a vector representing the rotation in P/Y/R euler angle format
  	* fov      : a number representing the vertical field of view
  	* znear    : a number representing the distance of the near clipping plane
  	* zfar     : a number representing the distance of the far clipping plane
  */
  PerspectiveCamera = function PerspectiveCamera(descriptor) {
    this.transform = {};

    this.transform.position = descriptor.position || Vector.create([0, 0, 0]);
    this.transform.rotation = descriptor.rotation || Vector.create([0, 0, 0]);

    this.fov = descriptor.fov || 50.0 * Math.PI / 180.0;
    this.znear = descriptor.znear || 0.1;
    this.zfar = descriptor.zfar || 200.0;

    this.setActive = function () {
      setActiveCamera(this);
    };
    this.isActive = function () {
      return getActiveCamera() == this;
    };

    this.ctype = 'perspective';
  };
  function createPerspectiveCamera(descriptor) {
    return new PerspectiveCamera(descriptor);
  }

  // Returns an object representing an orthogonal camera to be used as the perspective for rendering
  // After creation, the position and rotation can be freely modified as properties of its transform property (camera.transform.*), as well as the size property (camera.fov), znear (camera.znear), and zfar (camera.zfar)
  // Scale does not exist for cameras, as it would honestly make no sense
  // Size determines the vertical size in world units of the orthogonal capture
  //
  // @param { object } descriptor - an object filled with a number of optional keys
  /*
  	* position : a vector representing the position
  	* rotation : a vector representing the rotation in P/Y/R euler angle format
  	* size     : a number representing the vertical capture size
  	* znear    : a number representing the distance of the near clipping plane
  	* zfar     : a number representing the distance of the far clipping plane
  */
  OrthogonalCamera = function OrthogonalCamera(descriptor) {
    this.transform = {};

    this.transform.position = descriptor.position || Vector.create([0, 0, 0]);
    this.transform.rotation = descriptor.rotation || Vector.create([0, 0, 0]);

    this.size = descriptor.size || 5.0;
    this.znear = descriptor.znear || 0.1;
    this.zfar = descriptor.zfar || 80.0;

    this.setActive = function () {
      setActiveCamera(this);
    };
    this.isActive = function () {
      return getActiveCamera() == this;
    };

    this.ctype = 'orthogonal';
  };
  function createOrthogonalCamera(descriptor) {
    return new OrthogonalCamera(descriptor);
  }

  // Returns the camera currently being used for rendering
  function getActiveCamera() {
    return activeCamera;
  }

  // Sets the camera used in rendering to the provided camera
  // @param { object } camera - the camera object to set as the active camera
  function setActiveCamera(camera) {
    activeCamera = camera;
  }

  //            //
  //  ASSET IO  //
  //            //

  // Load a mesh into the meshes map to be used later - automatically calls initMesh
  // @param { string } mesh - the file path of the mesh to load
  function loadMesh(mesh) {
    // Load up the file, looks like we're doing this all manually
    var xhr = new XMLHttpRequest();

    // In here the actual mesh loading will occur
    xhr.onload = function () {
      initMesh(xhr.responseText, mesh);
    };

    // Setup and sent the request to fetch the file
    xhr.open('GET', mesh, true);
    xhr.setRequestHeader('If-Modified-Since', 'Thu, 1 Jan 1970 00:00:00 GMT');
    xhr.send();
  }

  // Push a loaded mesh into the meshes map to be used later for rendering
  // @param { string } mesh - the obj format representation of the mesh
  // @param { string } name - the name for the mesh to be saved as (usually the file path)
  function initMesh(mesh, name) {
    // Split the text into lines for easy iteration
    var lines = mesh.split('\n');

    var vp = [];
    var vt = [];
    var vn = [];
    var faces = [];

    for (var i = 0; i < lines.length; ++i) {
      // Split each line into its core components
      var chunks = lines[i].split(' ');

      // Check the label to determine what data is on the line
      switch (chunks[0]) {
        case 'v':
          vp.push(parseFloat(chunks[1]));
          vp.push(parseFloat(chunks[2]));
          vp.push(parseFloat(chunks[3]));
          break;
        case 'vt':
          vt.push(parseFloat(chunks[1]));
          vt.push(parseFloat(chunks[2]));
          break;
        case 'vn':
          vn.push(parseFloat(chunks[1]));
          vn.push(parseFloat(chunks[2]));
          vn.push(parseFloat(chunks[3]));
          break;
        case 'f':
          var f1 = chunks[1].split('/');
          var f2 = chunks[2].split('/');
          var f3 = chunks[3].split('/');

          faces.push(parseInt(f1[0], 10));
          faces.push(parseInt(f1[1], 10));
          faces.push(parseInt(f1[2], 10));
          faces.push(parseInt(f2[0], 10));
          faces.push(parseInt(f2[1], 10));
          faces.push(parseInt(f2[2], 10));
          faces.push(parseInt(f3[0], 10));
          faces.push(parseInt(f3[1], 10));
          faces.push(parseInt(f3[2], 10));

          break;
      }
    }
    createMesh({ vp: vp, vt: vt, vn: vn, faces: faces }, name);
  }

  function createMesh(meshData, name) {
    var vp = meshData.vp;
    var vt = meshData.vt;
    var vn = meshData.vn;
    var faces = meshData.faces;

    // Subtract one from all faces because reasons
    for (var i = 0; i < faces.length; i++) {
      faces[i] -= 1;
    }

    var dataBuffer = new Float32Array(faces.length * 8);
    var vpStart = 0;
    var vtStart = vpStart + faces.length * 3;
    var vnStart = vtStart + faces.length * 2;

    var face = null;

    // Boy howdy, look at them numbers
    // We got some real number crunchin' goin' on right here, we do
    for (var _i10 = 0; _i10 < faces.length; ++_i10) {
      face = faces[_i10 * 3 + 0];
      dataBuffer[_i10 * 3 + 0 + vpStart] = vp[face * 3 + 0];
      dataBuffer[_i10 * 3 + 1 + vpStart] = vp[face * 3 + 1];
      dataBuffer[_i10 * 3 + 2 + vpStart] = vp[face * 3 + 2];

      face = faces[_i10 * 3 + 1];
      dataBuffer[_i10 * 2 + 0 + vtStart] = vt[face * 2 + 0];
      dataBuffer[_i10 * 2 + 1 + vtStart] = vt[face * 2 + 1];

      face = faces[_i10 * 3 + 2];
      dataBuffer[_i10 * 3 + 0 + vnStart] = vn[face * 3 + 0];
      dataBuffer[_i10 * 3 + 1 + vnStart] = vn[face * 3 + 1];
      dataBuffer[_i10 * 3 + 2 + vnStart] = vn[face * 3 + 2];
    }

    var glBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dataBuffer), gl.STATIC_DRAW);

    // Whew, finally done; time to never look at this again
    meshes[name] = {
      buffer: glBuffer,
      count: dataBuffer.length / 8
    };
  }

  // Load a texture into the textures map to be used later
  // @param { string } tex - the file path of the texture to load
  function loadTexture(tex) {
    var image = new Image();
    image.onload = function () {
      initTexture(image, tex);
    };
    image.src = tex;
  }

  // Push a loaded texture into the textures map to be used later
  // @param { Image } tex - the loaded image object to initialize for rendering
  // @param { string } name - the name for the texture to be saved as (usually the file path)
  function initTexture(tex, name) {
    var glTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);

    // What a life-saver this extension is
    if (ext.aniso) {
      var max = gl.getParameter(ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      gl.texParameterf(gl.TEXTURE_2D, ext.aniso.TEXTURE_MAX_ANISOTROPY_EXT, max);
    }

    // WHY DOES NEAREST MAG FILTER ONLY SOMETIMES WORK??!!??!?!?!
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameterf(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);

    gl.generateMipmap(gl.TEXTURE_2D);

    // Always do this
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);

    textures[name] = glTex;
  }

  // Load a material and compile it into a shader
  // @param { string } mat - the file path of the material to load
  function loadMaterial(mat) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
      initMaterial(xhr.responseText, mat);
    };

    xhr.open('GET', mat, true);
    xhr.setRequestHeader('If-Modified-Since', 'Thu, 1 Jan 1970 00:00:00 GMT');
    xhr.send();
  }

  // Compile a loaded material into a shader
  // @param { string } mat - the material string to initialize for rendering
  // @param { string } name - the name for the material to be saved as (usually the file path)
  function initMaterial(mat, name) {
    // Vertex Shader
    var vShaderSource = app.shaders.vertexShader;
    var vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vShaderSource);
    gl.compileShader(vShader);

    // Fragment Shader - preMaterial + material + postMaterial
    var fShaderSource = app.shaders.preMaterial + mat + app.shaders.postMaterial;
    var fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fShaderSource);
    gl.compileShader(fShader);

    // Make sure it compiled correctly
    if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS)) {
      // console.log("Shader \"" + mat + "\" compilation error : " + gl.getShaderInfoLog(fShader));
      gl.deleteShader(fShader);
      return;
    }

    var shader = gl.createProgram();
    gl.attachShader(shader, vShader);
    gl.attachShader(shader, fShader);
    gl.linkProgram(shader);

    // Make sure the shader linked correctly
    if (!gl.getProgramParameter(shader, gl.LINK_STATUS)) {
      // console.log("Shader for material \"" + mat + "\"failed to initialize.");
      // console.error(gl.getProgramInfoLog(shader));
    }

    gl.useProgram(shader);

    // Fetch attribute locations
    var vpos = gl.getAttribLocation(shader, 'vpos');
    var vtex = gl.getAttribLocation(shader, 'vtex');
    var vnor = gl.getAttribLocation(shader, 'vnor');

    // Fetch matrix uniform locations
    var puni = gl.getUniformLocation(shader, 'persp');
    var wuni = gl.getUniformLocation(shader, 'world');

    // Find and link all the material uniforms
    var txUnis = {};
    var flUnis = {};
    var v4Unis = {};

    // Arrays of all material uniforms
    var txs = [];
    var fls = [];
    var v4s = [];

    // HERE is where I can change it to include uniforms from other parts of the shader
    var lines = mat.split('\n');
    for (var i = 0; i < lines.length; ++i) {
      var chunks = lines[i].split(' ');

      // Only bother going through if this line is a uniform
      if (chunks[0] != 'uniform') {
        continue;
      }

      // Slice that semicolon off the edge
      var uni = chunks[2].slice(0, -1);

      switch (chunks[1]) {
        case 'sampler2D':
          txUnis[uni] = gl.getUniformLocation(shader, uni);
          txs.push(uni);
          break;
        case 'vec4':
          v4Unis[uni] = gl.getUniformLocation(shader, uni);
          v4s.push(uni);
          break;
        case 'float':
          flUnis[uni] = gl.getUniformLocation(shader, uni);
          fls.push(uni);
          break;
      }
    }

    shaders[name] = {
      shader: shader,

      vpos: vpos,
      vtex: vtex,
      vnor: vnor,

      puni: puni,
      wuni: wuni,

      txUnis: txUnis,
      flUnis: flUnis,
      v4Unis: v4Unis,

      txs: txs,
      v4s: v4s,
      fls: fls
    };
  }

  function skyColor() {
    return sColor;
  }

  //          //
  //  RETURN  //
  //          //

  return {
    init: init,
    clear: clear,
    resize: resize,
    draw: draw,
    drawText: drawText,

    createMeshRenderable: createMeshRenderable,
    createParticleRenderable: createParticleRenderable,
    registerRenderable: registerRenderable,
    unregisterRenderable: unregisterRenderable,

    createPointLight: createPointLight,
    createDirectionalLight: createDirectionalLight,
    registerLight: registerLight,
    unregisterLight: unregisterLight,

    getAmbient: getAmbient,
    setAmbient: setAmbient,

    createPerspectiveCamera: createPerspectiveCamera,
    createOrthogonalCamera: createOrthogonalCamera,

    getActiveCamera: getActiveCamera,
    setActiveCamera: setActiveCamera,

    loadMesh: loadMesh,
    initMesh: initMesh,
    createMesh: createMesh,
    loadTexture: loadTexture,
    initTexture: initTexture,
    loadMaterial: loadMaterial,
    initMaterial: initMaterial,
    freeMesh: freeMesh,
    freeTexture: freeTexture,
    freeMaterial: freeMaterial,

    skyColor: skyColor
  };
}();
'use strict';

/* jslint browser:true */
/* jslint plusplus: true */

// The myKeys object will be in the global scope - it makes this script
// really easy to reuse between projects


var app = app || {};

app.myKeys = function () {
  var myKeys = {};

  myKeys.KEYBOARD = Object.freeze({
    KEY_LEFT: 37,
    KEY_UP: 38,
    KEY_RIGHT: 39,
    KEY_DOWN: 40,
    KEY_SPACE: 32,
    KEY_SHIFT: 16,
    KEY_A: 65,
    KEY_D: 68,
    KEY_S: 83,
    KEY_W: 87
  });

  // myKeys.keydown array to keep track of which keys are down
  // this is called a "key daemon"
  // main.js will "poll" this array every frame
  // this works because JS has "sparse arrays" - not every language does
  myKeys.keydown = [];

  // event listeners
  window.addEventListener('keydown', function (e) {
    // console.log("keydown=" + e.keyCode);
    myKeys.keydown[e.keyCode] = true;
  });

  window.addEventListener('keyup', function (e) {
    // console.log("keyup=" + e.keyCode);
    myKeys.keydown[e.keyCode] = false;

    // pausing and resuming
    var char = String.fromCharCode(e.keyCode);
  });

  return myKeys;
}();
"use strict";

/*
loader.js
variable 'app' is in global scope - i.e. a property of window.
app is our single global object literal - all other functions and properties of
the game will be properties of app.
*/

// if app exists use the existing copy
// else create a new empty object literal
var app = window.app || {};

window.onload = function () {
  app.main.myKeys = app.myKeys;
  app.main.graphics = app.graphics;
  app.main.audio = app.audio;
  app.main.init();
};
'use strict';

/* globals io */ // Socket.io
/* globals $V $L Vector */ // Sylvester
/* globals DirectionalLight PointLight */ // Rendering Engine Lights
/* globals  MeshRenderable ParticleRenderable */ // Rendering Engine Renderables

var app = window.app || {};

app.main = app.main || {
  // Properties
  GAME: {
    WIDTH: window.innerWidth - 20,
    HEIGHT: window.innerHeight - 20
  },
  GAME_STATE: Object.freeze({
    LOADING: 0,
    BEGIN: 1,
    DEFAULT: 2,
    PAUSED: 3
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
  standardTextures: {
    diffuseTexture: 'assets/textures/master.png',
    specularTexture: 'assets/textures/masterSpecular.png',
    emissionTexture: 'assets/textures/masterEmission.png'
  },
  chunkMeshData: [],

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

  sunRender: null,
  moonRender: null,

  entityList: {},
  user: null,

  updateRequired: false,

  // methods
  init: function init() {
    // Initialize properties
    this.canvas = document.querySelector('#txCanvas');
    this.canvas.onmousedown = this.doMousedown.bind(this);
    document.addEventListener('pointerlockchange', this.lockChangeAlert.bind(this), false);
    document.addEventListener('mozpointerlockchange', this.lockChangeAlert.bind(this), false);

    this.graphics.init(this.GAME.WIDTH, this.GAME.HEIGHT);
    // this.graphics.loadMesh("assets/meshes/stairs.obj");

    this.audio.loadSound('assets/sounds/BossaBossa.mp3', 'bossa');

    this.musicPlayer = new app.AudioPlayer('bossa');
    this.musicPlayer.time = 3.0;

    this.graphics.loadTexture('assets/textures/master.png');
    this.graphics.loadTexture('assets/textures/masterSpecular.png');
    this.graphics.loadTexture('assets/textures/masterEmission.png');

    this.graphics.loadTexture('assets/textures/torchDiffuse.png');
    this.graphics.loadTexture('assets/textures/torchEmission.png');

    this.graphics.loadTexture('assets/textures/sun.png');
    this.graphics.loadTexture('assets/textures/moon.png');

    this.sun = new DirectionalLight({
      direction: $V([-1, -1, -1]).toUnitVector(),
      intensity: $V([0.4, 0.36, 0.32])
    });
    this.sun.register();

    this.sunRender = new MeshRenderable({
      mesh: 'assets/meshes/cube.obj',
      rotation: $V([0.0, -Math.PI / 2, 0.0]),
      scale: $V([10, 10, 10]),
      textures: {
        emissionTexture: 'assets/textures/sun.png'
      }
    });
    this.sunRender.register();

    this.moonRender = new MeshRenderable({
      mesh: 'assets/meshes/cube.obj',
      rotation: $V([0.0, -Math.PI / 2, 0.0]),
      scale: $V([10, 10, 10]),
      textures: {
        emissionTexture: 'assets/textures/moon.png'
      }
    });
    this.moonRender.register();

    window.onresize = function () {
      this.GAME.WIDTH = window.innerWidth - 20;
      this.GAME.HEIGHT = window.innerHeight - 20;
      this.graphics.resize(this.GAME.WIDTH, this.GAME.HEIGHT);
    }.bind(this);

    this.gameState = this.GAME_STATE.LOADING;

    this.genWorker = io.connect();
    this.genWorker.on('connect', this.handleConnection.bind(this));

    // Start the game loop
    this.update();
  },
  update: function update() {
    this.animationID = requestAnimationFrame(this.update.bind(this));

    var dt = this.calculateDeltaTime();
    var cam = this.graphics.getActiveCamera().transform;

    if (this.gameState === this.GAME_STATE.LOADING) {
      this.graphics.clear();

      this.graphics.drawText('WEBCRAFT 2', this.GAME.WIDTH / 2 - 152, this.GAME.HEIGHT / 2 - 50, '32pt "Ubuntu Mono"', '#22ff22');
      this.graphics.drawText('By Ashwin Ganapathiraju and Kenneth Holland', this.GAME.WIDTH / 2 - 186, this.GAME.HEIGHT / 2 - 20, '10pt "Ubuntu Mono"', '#ff2222');
      this.graphics.drawText(this.genMessage, this.GAME.WIDTH / 2 - this.genMessage.length * 8, this.GAME.HEIGHT / 2 + 20, '16pt "Ubuntu Mono"', '#fff');
      this.graphics.drawText('[' + this.genStr + '] ' + this.genPercent + '%', this.GAME.WIDTH / 2 - 162, this.GAME.HEIGHT / 2 + 80, '18pt "Ubuntu Mono"', '#fff');
    } else if (this.gameState === this.GAME_STATE.BEGIN) {
      this.graphics.clear();

      this.graphics.drawText('WEBCRAFT 2', this.GAME.WIDTH / 2 - 152, this.GAME.HEIGHT / 2 - 50, '32pt "Ubuntu Mono"', '#22ff22');
      this.graphics.drawText('By Ashwin Ganapathiraju and Kenneth Holland', this.GAME.WIDTH / 2 - 186, this.GAME.HEIGHT / 2 - 20, '10pt "Ubuntu Mono"', '#ff2222');
      this.graphics.drawText('Click to start', this.GAME.WIDTH / 2 - 112, this.GAME.HEIGHT / 2 + 20, '16pt "Ubuntu Mono"', '#fff');
      this.graphics.drawText('Instructions:', this.GAME.WIDTH / 2 - 117, this.GAME.HEIGHT / 2 + 80, '18pt "Ubuntu Mono"', '#fff');
      this.graphics.drawText('WASDEQ to move', this.GAME.WIDTH / 2 - 126, this.GAME.HEIGHT / 2 + 115, '18pt "Ubuntu Mono"', 'A0A0A0');
      this.graphics.drawText('Arrows to pan', this.GAME.WIDTH / 2 - 117, this.GAME.HEIGHT / 2 + 140, '18pt "Ubuntu Mono"', 'A0A0A0');
      this.graphics.drawText('PO for music', this.GAME.WIDTH / 2 - 108, this.GAME.HEIGHT / 2 + 165, '18pt "Ubuntu Mono"', 'A0A0A0');
      this.worldTime = this.cycleTime / 4;
    } else if (this.gameState === this.GAME_STATE.PAUSED) {
      this.graphics.clear();

      this.graphics.drawText('PAUSED', this.GAME.WIDTH / 2 - 54, this.GAME.HEIGHT / 2 - 9, '18pt "Ubuntu Mono"', '#fff');
    } else if (this.gameState === this.GAME_STATE.DEFAULT) {
      if (this.handleKeyPress) {
        this.keyCheck(dt);
      }

      this.graphics.draw(dt);

      this.musicPlayer.time -= dt;
      if (this.musicPlayer.time <= 0.0) {
        this.musicPlayer.time = 170.0;
        this.musicPlayer.play();
      }
    }

    if (this.updateRequired) {
      this.graphics.clear();
      this.graphics.drawText('PLEASE REFRESH AND UPDATE', this.GAME.WIDTH / 2 - 200, this.GAME.HEIGHT / 2 + 20, '16pt "Ubuntu Mono"', '#f00');
      this.handleKeyPress = false;
      this.worldTime = 0;
      this.musicPlayer.pause();
      var mesh = this.chunkMeshData[this.chunkMeshData.length - 1];
      mesh.unregister();
      this.graphics.freeMesh(mesh.mesh);
      this.chunkMeshData.pop();
    }

    if (this.debug) {
      var pos = cam.position.elements;
      // Draw camera in top left corner
      this.graphics.drawText('x : ' + pos[0].toFixed(1), 8, 20, '10pt "Ubuntu Mono"', '#A0A0A0');
      this.graphics.drawText('y : ' + pos[1].toFixed(1), 8, 32, '10pt "Ubuntu Mono"', '#A0A0A0');
      this.graphics.drawText('z : ' + pos[2].toFixed(1), 8, 44, '10pt "Ubuntu Mono"', '#A0A0A0');
      this.graphics.drawText('g : ' + this.user.onGround, 8, 56, '10pt "Ubuntu Mono"', '#A0A0A0');
      this.graphics.drawText('h : ' + this.user.height, 8, 68, '10pt "Ubuntu Mono"', '#A0A0A0');
      // Draw rtime in top right corner
      this.graphics.drawText(this.readableTime(), this.GAME.WIDTH - 60, 20, '10pt "Ubuntu Mono"', '#A0A0A0');
      // Draw fps in bottom left corner
      this.graphics.drawText('fps : ' + (1 / dt).toFixed(3), 8, this.GAME.HEIGHT - 10, '18pt "Ubuntu Mono"', '#A0A0A0');
      // Draw dt in bottom right corner
      this.graphics.drawText('dt : ' + dt.toFixed(3), this.GAME.WIDTH - 150, this.GAME.HEIGHT - 10, '18pt "Ubuntu Mono"', '#A0A0A0');
    }

    this.handleSky();
  },
  keyCheck: function keyCheck(dt) {
    var cam = this.graphics.getActiveCamera().transform;
    var yaw = cam.rotation.elements[1];

    this.user.prevX = this.user.x;
    this.user.prevY = this.user.y;
    this.user.prevZ = this.user.z;

    this.user.prevRotationT = this.user.rotationT;
    this.user.prevRotationP = this.user.rotationP;

    if (this.myKeys.keydown[80]) {
      this.musicPaused = true;
      this.musicPlayer.pause();
    }
    if (this.myKeys.keydown[79]) {
      this.musicPaused = false;
      this.musicPlayer.resume();
    }

    if (this.myKeys.keydown[87]) {
      // forward - w
      cam.position.elements[0] -= Math.sin(yaw) * 20 * dt;
      cam.position.elements[2] -= Math.cos(yaw) * 20 * dt;
    }
    if (this.myKeys.keydown[83]) {
      // back - s
      cam.position.elements[0] += Math.sin(yaw) * 20 * dt;
      cam.position.elements[2] += Math.cos(yaw) * 20 * dt;
    }
    if (this.myKeys.keydown[65]) {
      // left - a
      cam.position.elements[0] -= Math.cos(yaw) * 20 * dt;
      cam.position.elements[2] += Math.sin(yaw) * 20 * dt;
    }
    if (this.myKeys.keydown[68]) {
      // right - d
      cam.position.elements[0] += Math.cos(yaw) * 20 * dt;
      cam.position.elements[2] -= Math.sin(yaw) * 20 * dt;
    }
    if (this.myKeys.keydown[32] && this.user.onGround) {
      // up - space
      cam.position.elements[1] += 50 * dt;
    }

    // Inverted up/down
    if (this.myKeys.keydown[38]) {
      // up
      cam.rotation.elements[0] -= 2 * dt; // look up
    }
    if (this.myKeys.keydown[40]) {
      // down
      cam.rotation.elements[0] += 2 * dt; // peer down
    }
    if (this.myKeys.keydown[37]) {
      // left
      cam.rotation.elements[1] += 2 * dt; // look left
    }
    if (this.myKeys.keydown[39]) {
      // right
      cam.rotation.elements[1] -= 2 * dt; // peer right
    }

    cam.rotation.elements[0] = window.clamp(cam.rotation.elements[0], -1.5, 1.5);

    this.user.destX = cam.position.elements[0];
    this.user.destY = cam.position.elements[1];
    this.user.destZ = cam.position.elements[2];

    this.user.rotationP = cam.rotation.elements[0];
    this.user.rotationT = cam.rotation.elements[1];

    this.user.alpha = 1;

    // Entity update
    var keys = Object.keys(this.entityList);
    for (var i = 0; i < keys.length; i++) {
      var entity = this.entityList[keys[i]];

      // Update alpha
      if (entity.alpha < 1) {
        entity.alpha += 0.05;
      }

      // Lerp position
      entity.x = window.lerp(entity.prevX, entity.destX, entity.alpha);
      entity.y = window.lerp(entity.prevY, entity.destY, entity.alpha);
      entity.z = window.lerp(entity.prevZ, entity.destZ, entity.alpha);

      var x = -Math.sin(entity.rotationT - 0.4) * 1.5;
      var z = -Math.cos(entity.rotationT - 0.4) * 1.5;

      var tx = -Math.sin(entity.rotationT - 0.42) * 1.5;
      var tz = -Math.cos(entity.rotationT - 0.42) * 1.5;

      entity.torchParticle.transform.position.elements[0] = x + entity.x;
      entity.torchParticle.transform.position.elements[1] = entity.y - 0.3;
      entity.torchParticle.transform.position.elements[2] = z + entity.z;

      entity.torch.transform.position.elements[0] = tx + entity.x;
      entity.torch.transform.position.elements[1] = entity.y - 0.5;
      entity.torch.transform.position.elements[2] = tz + entity.z;

      entity.torchLight.position = entity.torch.transform.position;

      entity.torch.transform.rotation.elements[1] = cam.rotation.elements[1];

      if (entity === this.user) {
        cam.position.elements[0] = entity.x;
        cam.position.elements[1] = entity.y;
        cam.position.elements[2] = entity.z;
      }
    }

    // Emit update
    this.genWorker.emit('movement', this.getSendingUser());
  },
  getSendingUser: function getSendingUser() {
    return {
      x: this.user.x,
      y: this.user.y,
      z: this.user.z,
      prevX: this.user.prevX,
      prevY: this.user.prevY,
      prevZ: this.user.prevZ,
      destX: this.user.destX,
      destY: this.user.destY,
      destZ: this.user.destZ,
      rotationT: this.user.rotationT,
      rotationP: this.user.rotationP,
      onGround: this.user.onGround,
      height: this.user.height,
      lastUpdate: this.user.lastUpdate
    };
  },
  calculateDeltaTime: function calculateDeltaTime() {
    var now = performance.now();
    var fps = 1000 / (now - this.lastTime);
    this.lastTime = now;
    return 1 / fps;
  },
  doMousedown: function doMousedown(e) {
    var mouse = window.getMouse(e);

    this.pmouse = mouse;
    this.canvas.requestPointerLock();

    this.resumeGame();
  },
  lockChangeAlert: function lockChangeAlert() {
    if (document.pointerLockElement === this.canvas || document.mozPointerLockElement === this.canvas) {
      this.resumeGame();
    } else {
      // this.pauseGame();
    }
  },
  pauseGame: function pauseGame() {
    if (this.gameState === this.GAME_STATE.DEFAULT) {
      cancelAnimationFrame(this.animationID);
      this.gameState = this.GAME_STATE.PAUSED;
      this.handleKeyPress = false;
      this.update();
      this.musicPlayer.pause();
    }
  },
  resumeGame: function resumeGame() {
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
  getAltitude: function getAltitude(period, time, shift) {
    if (period === 0) {
      return 0.25;
    }
    var f1 = time % period / period - 0.25;

    if (f1 < 0.0) {
      ++f1;
    }

    if (f1 > 1.0) {
      --f1;
    }

    var f2 = f1;
    f1 = 1.0 - (Math.cos(f1 * Math.PI) + 1.0) / 2.0;
    f1 = f2 + (f1 - f2) / 3.0;
    return f1 + shift / 360.0 + 0.25;
  },
  getSkyColor: function getSkyColor(altitude) {
    return Math.cos((altitude + 0.5) * Math.PI * 2.0) * 0.5 + 0.5;
  },
  getSkyBlend: function getSkyBlend() {
    var temp = 2.0; // MC "Desert" biome
    var k = Math.max(-1.0, Math.min(1.0, temp / 3.0));
    return $V([0.6222 - k * 0.05, 0.5 + k * 0.1, 1.0]);
  },
  handleSky: function handleSky() {
    var sunAlt = this.getAltitude(this.cycleTime, this.worldTime, 0);
    var moonAlt = this.getAltitude(this.cycleTime, this.worldTime, 180);

    var gradient = Math.max(0, Math.min(1, this.getSkyColor(sunAlt)));
    var skyColor = this.getSkyBlend().multiply(gradient);

    this.graphics.skyColor().elements = skyColor.elements;
    this.graphics.setAmbient(skyColor);

    var camPos = this.graphics.getActiveCamera().transform.position;
    this.drawCelestial(this.sunRender, sunAlt, camPos);
    this.drawCelestial(this.moonRender, moonAlt, camPos);

    this.sun.intensity = $V([0.5, 0.4, 0.4]).multiply(gradient);

    this.worldTime++;
  },
  drawCelestial: function drawCelestial(o, altitude, camPos) {
    var obj = o;
    var a = (altitude + 0.5) * Math.PI * 2 % (Math.PI * 2);
    obj.transform.position = $V([0, 180, 0]).rotate(a, $L([0, 0, 0], [0, 0, 1])).add(camPos);
  },
  readableTime: function readableTime() {
    var ticks = this.worldTime / this.cycleTime % 1.0 * 1440;
    var theHour = Math.floor(ticks / 60);
    var absHour = Math.abs(theHour);
    var tMinute = Math.floor(ticks % 60);
    var aMinute = Math.abs(tMinute);
    var aMin = (aMinute < 10 ? '0' : '') + aMinute;
    return (theHour < 0 || tMinute < 0 ? '-' : '') + absHour + ':' + aMin;
  },
  handleConnection: function handleConnection() {
    var _this = this;

    this.genWorker.on('genMsg', function (data) {
      if (_this.gameState !== _this.GAME_STATE.LOADING) {
        _this.updateRequired = true;
        return;
      }
      _this.genMessage = data.genMessage;
      _this.genStr = data.genStr;
      _this.genPercent = data.genPercent;
    });

    this.genWorker.on('meshData', function (data) {
      if (_this.gameState !== _this.GAME_STATE.LOADING) {
        return;
      }
      var meshData = data.meshData;

      for (var i = 0; i < meshData.str.length; i++) {
        var tex = 'chunk' + meshData.chunkIndex + '-' + i;
        _this.graphics.createMesh(meshData.str[i], tex);
        var mesh = new MeshRenderable({
          textures: _this.standardTextures,
          mesh: tex,
          posOnly: true,
          opaque: i !== 0,
          position: $V([meshData.chunkX, 0, meshData.chunkZ])
        });
        mesh.register();
        _this.chunkMeshData.push(mesh);
      }

      if (data.finished) {
        _this.gameState = _this.GAME_STATE.BEGIN;
      }
    });

    this.genWorker.on('timeUpdate', function (data) {
      _this.worldTime = data.time;
    });

    this.genWorker.on('update', function (data) {
      var entity = _this.entityList[data.id];

      if (!entity) {
        entity = _this.entityList[data.id] = data;

        entity.mesh = new MeshRenderable({
          mesh: 'assets/meshes/cube.obj',
          position: $V([data.x, data.y, data.z]),
          scale: data.selfUser ? $V([0, 0, 0]) : $V([1, 1, 1])
        });
        entity.mesh.register();

        entity.torchParticle = new ParticleRenderable({});
        entity.torchParticle.register();

        entity.torch = new MeshRenderable({
          scale: $V([0.05, 0.4, 0.05]),
          rotation: $V([-0.2, 0.0, 0.2]),
          textures: {
            diffuseTexture: 'assets/textures/torchDiffuse.png',
            emissionTexture: 'assets/textures/torchEmission.png'
          }
        });
        entity.torch.register();

        entity.torchLight = new PointLight({ intensity: $V([0.6, 0.5, 0.3]), radius: 20.0 });
        entity.torchLight.register();

        if (data.selfUser) {
          _this.user = entity;
          var cam = _this.graphics.getActiveCamera().transform;
          cam.position.elements[0] = entity.x;
          cam.position.elements[1] = entity.y;
          cam.position.elements[2] = entity.z;
          cam.rotation.elements[0] = entity.rotationP;
          cam.rotation.elements[1] = entity.rotationT;
        }
        return;
      }
      if (entity.lastUpdate >= data.lastUpdate) {
        return;
      }
      entity.lastUpdate = data.lastUpdate;
      entity.x = data.x;
      entity.y = data.y;
      entity.z = data.z;
      entity.prevX = data.prevX;
      entity.prevY = data.prevY;
      entity.prevZ = data.prevZ;
      entity.destX = data.destX;
      entity.destY = data.destY;
      entity.destZ = data.destZ;
      entity.rotationT = data.rotationT;
      entity.rotationP = data.rotationP;
      entity.onGround = data.onGround;
      entity.height = data.height;
      entity.alpha = 0;
      entity.mesh.transform.position.elements[0] = entity.x;
      entity.mesh.transform.position.elements[1] = entity.y;
      entity.mesh.transform.position.elements[2] = entity.z;

      if (entity === _this.user) {
        var _cam = _this.graphics.getActiveCamera().transform;
        _cam.position.elements[0] = entity.x;
        _cam.position.elements[1] = entity.y;
        _cam.position.elements[2] = entity.z;
        _cam.rotation.elements[0] = entity.rotationP;
        _cam.rotation.elements[1] = entity.rotationT;
      }
    });

    this.genWorker.on('kill', function (data) {
      _this.entityList[data.id].mesh.unregister();
      _this.entityList[data.id].torch.unregister();
      _this.entityList[data.id].torchParticle.unregister();
      _this.entityList[data.id].torchLight.unregister();
      delete _this.entityList[data.id];
    });

    this.genWorker.emit('join', { name: 'Player' + Math.floor(Math.random() * 100) });
  }
};
"use strict";

var app = app || {};

app.shaders = function () {
	// Manipulates the vertices and sets up for the material shader
	var vertexShader = "\nattribute vec3 vpos;\nattribute vec2 vtex;\nattribute vec3 vnor;\n\nuniform mat4 world;\nuniform mat4 persp;\n\nvarying vec3 pos;\nvarying vec2 uv;\nvarying vec3 norm;\n\nvoid main(void)\n{\n\tpos = vec3(world * vec4(vpos, 1.0));\n\tuv = vtex;\n\tnorm = normalize(vec3(world * vec4(vnor, 0.0)));\n\n\tgl_Position = persp * world * vec4(vpos, 1.0);\n}\n";

	// Sets the shader up for the material calculation
	var preMaterial = "\n#extension GL_EXT_draw_buffers : require\nprecision mediump float;\n\nvarying vec3 pos;\nvarying vec2 uv;\nvarying vec3 norm;\n\nvec3 diffuse = vec3(0.5);\nvec3 normal = vec3(0.0, 0.0, 1.0);\nvec3 specular = vec3(0.5);\nvec3 emission = vec3(0.0);\nfloat roughness = 0.5;\nfloat opacity = 1.0;\n";

	// Interprets the results of the material
	var postMaterial = "\nuniform vec4 camPos;\n\n// float fogStart = 64.0;\n// float fogEnd = 80.0;\n\nvoid main(void)\n{\n\tmaterial();\n\n\n\t// float dist = length(vec3(camPos) - pos);\n\t// float fog = (dist - fogStart) / (fogEnd - fogStart);\n\t// fog = clamp(fog, 0.0, 1.0);\n\n\n\tgl_FragData[0] = vec4(diffuse, opacity);\n\n\tgl_FragData[1] = vec4(norm, 0.0);\n\n\tgl_FragData[2] = vec4(specular, roughness);\n\n\tgl_FragData[3] = vec4(emission, 1.0);\n\n\tgl_FragData[4] = vec4(pos, 1.0);\n}\n";

	// Creates the material function which serves as the "meat" of the material
	var defaultMaterial = "\nuniform sampler2D diffuseTexture;\nuniform sampler2D specularTexture;\nuniform sampler2D emissionTexture;\n\nvoid material(void)\n{\n\tvec4 dTex = texture2D(diffuseTexture, uv);\n\tvec4 sTex = texture2D(specularTexture, uv);\n\tvec4 eTex = texture2D(emissionTexture, uv);\n\n\n\tdiffuse = dTex.rgb;\n\topacity = dTex.a;\n\tspecular = sTex.rgb;\n\troughness = sTex.a;\n\temission = eTex.rgb;\n}\n";

	// Simple vertex shader for lights
	var lightVertex = "\nattribute vec3 vpos;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tuv = vec2((vpos + vec3(1.0)) / 2.0);\n\tgl_Position = vec4(vpos, 1.0);\n}\n";

	// Sets the emission value
	var lightPrepass = "\nprecision mediump float;\n\nuniform sampler2D emission;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tgl_FragData[0] = texture2D(emission, uv);\n}\n";

	// Ambient light pass
	var lightAmbient = "\nprecision mediump float;\n\nuniform sampler2D diffuse;\n\nuniform vec4 intensity;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tvec4 dtex = texture2D(diffuse, uv);\n\tgl_FragData[0] = vec4(intensity.rgb * dtex.rgb, dtex.a);\n}\n";

	var lightDirectional = "\nprecision mediump float;\n\nuniform sampler2D diffuse;\nuniform sampler2D normal;\nuniform sampler2D specular;\nuniform sampler2D position;\n\nuniform vec4 direction;\nuniform vec4 intensity;\nuniform vec4 camPos;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tvec3 opDir = -vec3(direction);\n\n\tvec4 dtex = texture2D(diffuse, uv);\n\n\t// DIFFUSE\n\n\tvec3 normTex = texture2D(normal, uv).rgb;\n\tfloat diff = max(dot(normTex, opDir), 0.0);\n\tvec3 diffuseIntensity = (intensity * diff).rgb * dtex.rgb;\n\n\t// SPECULAR\n\n\tvec3 fragPos = texture2D(position, uv).rgb;\n\tvec3 viewDir = normalize(vec3(camPos) - fragPos);\n\tvec3 reflectDir = reflect(vec3(direction), normTex);\n\tvec4 specTex = texture2D(specular, uv);\n\tfloat spec = pow(max(dot(viewDir, reflectDir), 0.0), 2.0 / max(specTex.a * specTex.a, 0.01));\n\tvec3 specularIntensity = (intensity.rgb * spec) * specTex.rgb;\n\n\tgl_FragData[0] = vec4(diffuseIntensity + specularIntensity, dtex.a);\n}\n";

	var lightPoint = "\nprecision mediump float;\n\nuniform sampler2D diffuse;\nuniform sampler2D normal;\nuniform sampler2D specular;\nuniform sampler2D position;\n\nuniform vec4 lightPos;\nuniform vec4 intensity;\nuniform vec4 camPos;\nuniform float radius;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tvec3 fragPos = texture2D(position, uv).rgb;\n\n\tfloat dist = length(fragPos - vec3(lightPos));\n\tfloat power = max(1.0 - (dist / radius), 0.0);\n\n\tvec3 direction = normalize(fragPos - vec3(lightPos));\n\tvec3 opDir = -vec3(direction);\n\n\tvec4 dtex = texture2D(diffuse, uv);\n\n\t// DIFFUSE\n\n\tvec3 normTex = texture2D(normal, uv).rgb;\n\tfloat diff = max(dot(normTex, opDir), 0.0);\n\tvec3 diffuseIntensity = (intensity * diff).rgb * dtex.rgb;\n\n\t// SPECULAR\n\n\tvec3 viewDir = normalize(vec3(camPos) - fragPos);\n\tvec3 reflectDir = reflect(vec3(direction), normTex);\n\tvec4 specTex = texture2D(specular, uv);\n\tfloat spec = pow(max(dot(viewDir, reflectDir), 0.0), 2.0 / max(specTex.a * specTex.a, 0.01));\n\tvec3 specularIntensity = (intensity.rgb * spec) * specTex.rgb;\n\n\tgl_FragData[0] = vec4((diffuseIntensity + specularIntensity) * power, dtex.a);\n}\n";

	// Renders particles
	var particleVS = "\nattribute vec3 vpos;\n\nuniform mat4 cam;\nuniform mat4 persp;\n\nuniform vec4 pos;\nuniform vec2 scale;\n\nvarying vec2 uv;\nvarying vec3 newPos;\n\nvoid main(void)\n{\n\tuv = vec2((vpos + vec3(1.0)) / 2.0);\n\n\tvec3 vertPos = vec3((vpos.xy * scale.xy) * 0.1, vpos.z);\n\n\tnewPos = pos.xyz;\n\n\tvec3 tempPos = vec3(cam * pos);\n\ttempPos += vertPos;\n\n\tvec4 finalPos = persp * vec4(tempPos, 1.0);\n\n\tgl_Position = finalPos;\n}\n";

	// Also renders particles
	var particleFS = "\nprecision mediump float;\n\nuniform sampler2D texture;\nuniform sampler2D oldPos;\n\nuniform vec3 camPos;\nuniform vec2 screenSize;\n\nvarying vec2 uv;\nvarying vec3 newPos;\n\n// Get the length-squared, as it is faster\nfloat lsq(vec3 vector)\n{\n\treturn (vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);\n}\n\nvoid main(void)\n{\n\tvec2 screenUV = gl_FragCoord.xy / screenSize;\n\n\tvec4 tex = texture2D(texture, uv);\n\tvec3 posTex = texture2D(oldPos, screenUV).xyz;\n\n\tfloat oldDist = lsq(posTex - camPos);\n\tfloat newDist = lsq(newPos - camPos);\n\n\tif (newDist > oldDist) { discard; }\n\n\tgl_FragData[0] = tex;\n}\n";

	// Fuses the opaque and transparent framebuffers
	var fusionFS = "\nprecision mediump float;\n\nuniform sampler2D opaque;\nuniform sampler2D transparent;\nuniform sampler2D diffuse;\nuniform sampler2D particle;\n\nuniform vec3 skyColor;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tvec4 opaqueTex = texture2D(opaque, uv);\n\tvec4 transparentTex = texture2D(transparent, uv);\n\tvec4 diffuseTex = texture2D(diffuse, uv);\n\tvec4 partTex = texture2D(particle, uv);\n\n\tfloat oa = opaqueTex.a;\n\toa = clamp(oa, 0.0, 1.0);\n\tfloat alpha = diffuseTex.a;\n\tfloat pa = partTex.a;\n\n\t// Who needs built-in blending when you have the power of poor shader design\n\tvec4 result = opaqueTex * oa + vec4(skyColor * (1.0 - oa), 1.0);\n\tresult = vec4(vec3(transparentTex) * alpha + vec3(result) * (1.0 - alpha), 1.0);\n\tgl_FragData[0] = vec4(vec3(partTex) * pa + vec3(result) * (1.0 - pa), 1.0);\n}\n";

	// TODO : Implement
	var hdrFS = "\nprecision mediump float;\n\nuniform sampler2D tex;\n\nvarying vec2 uv;\n\nvoid main(void)\n{\n\tgl_FragColor = texture2D(tex, uv);\n}\n";

	return {
		vertexShader: vertexShader,
		preMaterial: preMaterial,
		postMaterial: postMaterial,
		defaultMaterial: defaultMaterial,

		lightVertex: lightVertex,
		lightPrepass: lightPrepass,
		lightAmbient: lightAmbient,
		lightDirectional: lightDirectional,
		lightPoint: lightPoint,

		particleVS: particleVS,
		particleFS: particleFS,

		fusionFS: fusionFS,
		hdrFS: hdrFS
	};
}();
"use strict";

/* eslint-env browser */
// All of these functions are in the global scope

// returns mouse position in local coordinate system of element
window.getMouse = function (e) {
  var mouse = {}; // make an object
  mouse.x = e.pageX - e.target.offsetLeft;
  mouse.y = e.pageY - e.target.offsetTop;
  return mouse;
};

window.getRandom = function (min, max) {
  return Math.random() * (max - min) + min;
};

window.nextInt = function (i) {
  return Math.floor(Math.random() * i);
};

window.makeColor = function (red, green, blue, alpha) {
  return "rgba(" + red + "," + green + "," + blue + ", " + alpha + ")";
};

// Function Name: getRandomColor()
// returns a random color of alpha 1.0
// http://paulirish.com/2009/random-hex-color-code-snippets/
window.getRandomColor = function () {
  var red = Math.round(Math.random() * 200 + 55);
  var green = Math.round(Math.random() * 200 + 55);
  var blue = Math.round(Math.random() * 200 + 55);
  var color = "rgb(" + red + "," + green + "," + blue + ")";
  // OR	if you want to change alpha
  // var color='rgba('+red+','+green+','+blue+',0.50)'; // 0.50
  return color;
};

window.getRandomUnitVector = function () {
  var x = window.getRandom(-1, 1);
  var y = window.getRandom(-1, 1);
  var length = Math.sqrt(x * x + y * y);
  if (length === 0) {
    // very unlikely
    x = 1; // point right
    y = 0;
    length = 1;
  } else {
    x /= length;
    y /= length;
  }

  return { x: x, y: y };
};

window.simplePreload = function (imageArray) {
  // loads images all at once
  for (var i = 0; i < imageArray.length; i++) {
    var img = new Image();
    img.src = imageArray[i];
  }
};

window.loadImagesWithCallback = function (sources, callback) {
  var imageObjects = [];
  var numImages = sources.length;
  var numLoadedImages = 0;
  var func = function func() {
    numLoadedImages++;
    // console.log("loaded image at '" + this.src + "'")
    if (numLoadedImages >= numImages) {
      callback(imageObjects); // send the images back
    }
  };

  for (var i = 0; i < numImages; i++) {
    imageObjects[i] = new Image();
    imageObjects[i].onload = func;
    imageObjects[i].src = sources[i];
  }
};

/*
Function Name: clamp(val, min, max)
Author: Web - various sources
Return Value: the constrained value
Description: returns a value that is
constrained between min and max (inclusive)
*/
window.clamp = function (val, min, max) {
  return Math.max(min, Math.min(max, val));
};

// FULL SCREEN MODE
window.requestFullscreen = function (element) {
  if (element.requestFullscreen) {
    element.requestFullscreen();
  } else if (element.mozRequestFullscreen) {
    element.mozRequestFullscreen();
  } else if (element.mozRequestFullScreen) {
    // camel-cased 'S' was changed to 's' in spec
    element.mozRequestFullScreen();
  } else if (element.webkitRequestFullscreen) {
    element.webkitRequestFullscreen();
  }
  // .. and do nothing if the method is not supported
};

// Thanks Cody-sempai!
window.lerp = function (v0, v1, alpha) {
  return (1 - alpha) * v0 + alpha * v1;
};
