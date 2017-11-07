const app = window.app || {};

// Function constructors as alternatives to make* functions
// see actual create* function for documentation
let MeshRenderable = null;
let ParticleRenderable = null;
let Particle = null;
let PointLight = null;
let DirectionalLight = null;
let PerspectiveCamera = null;
let OrthogonalCamera = null;

// To all ye who dare enter : good luck in there
app.graphics = (function () {
	// /////////////
	//           //
	//  PRIVATE  //
	//           //
	// /////////////

	//              //
	//  PROPERTIES  //
	//              //

	// Keep track of the canvases
  let glCanvas = null;
  let txCanvas = null;

	// Context for advanced rendering to the WebGL-canvas
  let gl = null;
	// Context for rendering text to the text-canvas
  let tx = null;

	// Map containing all loaded shaders, indexed with the shader name
  const shaders = {};
	// Map containing all loaded meshes, indexed with the mesh file name
  const meshes = {};
	// Map containing all loaded textures, indexed with the texture file name
  const textures = {};

	// Used to generate the perspective matrix and bring the scene into eye space during rendering
  let activeCamera = null;
  let cameraMatrix = null;
	// This matrix is only the perspective matrix, used to speed up particle rendering
  let perspMatrix = null;
	// This matrix is only the camera's transformation matrix
  let camTransform = null;
  let aspectRatio = 0.0;

	// The list of all renderables currently in the scene to be drawn
  const renderables = [];

	// The list of transparent renderables
  const transparents = [];

	// List of particle systems, which spawn particles
  const particleSystems = [];

	// The list of particles to render
  const particles = [];

	// List of all directional lights
  const directionalLights = [];

	// List of all point lights
  const pointLights = [];

	// Ambient light
  let ambientIntensity = null;

	// The list of all framebuffers used for deferred shading, by name
  const framebuffer = {};

	// The opaque HDR framebuffer
  const opaqueBuffer = {};

	// The transparent HDR framebuffer
  const transparentBuffer = {};

	// Buffer used for particles
  const particleBuffer = {};

	// The final HDR framebuffer
  const hdrBuffer = {};

	// Collection of all used extensions
  const ext = {};

	// Sneaky variable to speed up the process of transitioning between renderables
  let lastDrawnRenderable = null;

	// Organize the texture binding points better. Honestly using a macro enum instead of a simple number was a terrible design decision for OpenGL
  let glTextureBinds = null;

	// Matrix used for fast-transform of posOnly renderables
  let fastMatrix = null;

	// Cheap trick added last-minute to fake a sky color
  let sColor = null;

	//                    //
	//  MATRIX FUNCTIONS  //
	//                    //

	// Creates a matrix which translates by the provided vector
  function translationMatrix(v)	{
    const mat = Matrix.I(4);

    mat.elements[0][3] = v.elements[0];
    mat.elements[1][3] = v.elements[1];
    mat.elements[2][3] = v.elements[2];

    return mat;
  }

	// Creates a matrix which scales by the provided vector
  function scaleMatrix(v)	{
    return Matrix.Diagonal([v.elements[0], v.elements[1], v.elements[2], 1.0]);
  }

	// Creates a matrix which rotates using the provided vector in <P/Y/R> notation
  function rotationMatrix(v)	{
    const rotP = Matrix.RotationX(v.elements[0]);
    let rotY = Matrix.RotationY(v.elements[1]);
    const rotR = Matrix.RotationZ(v.elements[2]);

    rotY = rotY.multiply(rotP);
    rotY = rotY.multiply(rotR);

    promoteMatrix(rotY);

    return rotY;
  }

	// Uses camera data to create the camera's transform/perspective matrix
  function generateCameraMatrix()	{
		// Build the transformation matrix in reverse rather than making a call to inverse - this is much faster, although slightly less clean
    const rotP = Matrix.RotationX(activeCamera.transform.rotation.elements[0] * -1);
    const rotY = Matrix.RotationY(activeCamera.transform.rotation.elements[1] * -1);
    const rotR = Matrix.RotationZ(activeCamera.transform.rotation.elements[2] * -1);
    const matT = translationMatrix(activeCamera.transform.position.multiply(-1));

    let matTransform = rotR.multiply(rotP);
    matTransform = matTransform.multiply(rotY);
    promoteMatrix(matTransform);
    matTransform = matTransform.multiply(matT);

    let matPerspective = null;

    if (activeCamera.ctype == 'perspective')		{
			// Build the perspective matrix
      const r = Math.tan(activeCamera.fov * 0.5) * activeCamera.znear;
      const x = (2.0 * activeCamera.znear) / (2.0 * r * aspectRatio);
      const y = activeCamera.znear / r;
      const z = -(activeCamera.zfar + activeCamera.znear) / (activeCamera.zfar - activeCamera.znear);
      const p = -(2.0 * activeCamera.zfar * activeCamera.znear) / (activeCamera.zfar - activeCamera.znear);

      matPerspective = Matrix.create([
				[x, 0, 0, 0],
				[0, y, 0, 0],
				[0, 0, z, p],
				[0, 0, -1, 0],
      ]);
    }		else		{
      const x = 2.0 / activeCamera.size / aspectRatio;
      const y = 2.0 / activeCamera.size;
      const z = 1.0 / activeCamera.zfar;

      matPerspective = Matrix.create([
				[x, 0, 0, 0],
				[0, y, 0, 0],
				[0, 0, z, 0],
				[0, 0, 0, 1],
      ]);
    }

    perspMatrix = flattenMatrix(matPerspective);
    camTransform = flattenMatrix(matTransform);

		// And finally set the camera matrix accordingly
    cameraMatrix = flattenMatrix(matPerspective.multiply(matTransform));
  }

	// Promotes a 3x3 matrix to a 4x4 matrix - should only be used for rotation matrices
  function promoteMatrix(m)	{
    m.elements.push([0.0, 0.0, 0.0, 1.0]);
    m.elements[0].push([0.0]);
    m.elements[1].push([0.0]);
    m.elements[2].push([0.0]);
  }

	// Flatten a matrix into a Float32Array useable by WebGL
  function flattenMatrix(m)	{
    return new Float32Array([
      m.e(1, 1), m.e(2, 1), m.e(3, 1), m.e(4, 1),
      m.e(1, 2), m.e(2, 2), m.e(3, 2), m.e(4, 2),
      m.e(1, 3), m.e(2, 3), m.e(3, 3), m.e(4, 3),
      m.e(1, 4), m.e(2, 4), m.e(3, 4), m.e(4, 4),
    ]);
  }

	//

	// Function used for particle sorting, sorts farthest to nearest
  function particleSort(a, b)	{
    let dista = (activeCamera.transform.position.elements[0] - a.position.elements[0]) * (activeCamera.transform.position.elements[0] - a.position.elements[0]);
    dista += (activeCamera.transform.position.elements[1] - a.position.elements[1]) * (activeCamera.transform.position.elements[1] - a.position.elements[1]);
    dista += (activeCamera.transform.position.elements[2] - a.position.elements[2]) * (activeCamera.transform.position.elements[2] - a.position.elements[2]);

    let distb = (activeCamera.transform.position.elements[0] - b.position.elements[0]) * (activeCamera.transform.position.elements[0] - b.position.elements[0]);
    distb += (activeCamera.transform.position.elements[1] - b.position.elements[1]) * (activeCamera.transform.position.elements[1] - b.position.elements[1]);
    distb += (activeCamera.transform.position.elements[2] - b.position.elements[2]) * (activeCamera.transform.position.elements[2] - b.position.elements[2]);

		// Sort the particles farthest to nearest
    return distb - dista;
  }

	//                  //
	//  INITIALIZATION  //
	//                  //

	// Grab all the extensions to be used throughout rendering
  function initExtensions()	{
		// Needed to make texture sampling less horrible
    ext.aniso = (gl.getExtension('EXT_texture_filter_anisotropic') ||
		              gl.getExtension('MOZ_EXT_texture_filter_anisotropic') ||
		              gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic'));

		// Needed to perform proper deferred rendering
    ext.dbuffer = gl.getExtension('WEBGL_draw_buffers');
    ext.dtex = gl.getExtension('WEBGL_depth_texture');
    ext.fpb = gl.getExtension('OES_texture_float');
    ext.hfb = gl.getExtension('OES_texture_half_float');
  }

	// Initializes the framebuffers to use in deferred shading
  function initFramebuffer(x, y)	{
    if (framebuffer.textures)		{
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

  function initLightShaders()	{
		// Setup that ambient light
		// AHAHAA I'M APPLYING THE AMBIENT LIGHT TO THE BACKGROUND?? I'll fix it later
    ambientIntensity = new Float32Array([0.5, 0.46, 0.42, 1.0]);

		// Vertex Shader - shared across all lights
    const vShaderSource = app.shaders.lightVertex;
    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vShaderSource);
    gl.compileShader(vShader);

		// Lighting prepass fragment shader
    const prepassSource = app.shaders.lightPrepass;
    const prepass = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(prepass, prepassSource);
    gl.compileShader(prepass);
    const prepassShader = gl.createProgram();
    gl.attachShader(prepassShader, vShader);
    gl.attachShader(prepassShader, prepass);
    gl.linkProgram(prepassShader);
    gl.useProgram(prepassShader);
    shaders.lightPrepass =
    {
      shader: prepassShader,
      vpos: gl.getAttribLocation(prepassShader, 'vpos'),
      emission: gl.getUniformLocation(prepassShader, 'emission'),
    };

		// Ambient light fragment shader
    const ambientSource = app.shaders.lightAmbient;
    const ambient = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(ambient, ambientSource);
    gl.compileShader(ambient);
    const ambientShader = gl.createProgram();
    gl.attachShader(ambientShader, vShader);
    gl.attachShader(ambientShader, ambient);
    gl.linkProgram(ambientShader);
    gl.useProgram(ambientShader);
    shaders.lightAmbient =
    {
      shader: ambientShader,
      vpos: gl.getAttribLocation(ambientShader, 'vpos'),
      diffuse: gl.getUniformLocation(ambientShader, 'diffuse'),
      intensity: gl.getUniformLocation(ambientShader, 'intensity'),
    };

		// Directional light fragment shader
    const directionalSource = app.shaders.lightDirectional;
    const directional = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(directional, directionalSource);
    gl.compileShader(directional);
    const directionalShader = gl.createProgram();
    gl.attachShader(directionalShader, vShader);
    gl.attachShader(directionalShader, directional);
    gl.linkProgram(directionalShader);

    gl.useProgram(directionalShader);
    shaders.lightDirectional =
    {
      shader: directionalShader,
      vpos: gl.getAttribLocation(directionalShader, 'vpos'),
      diffuse: gl.getUniformLocation(directionalShader, 'diffuse'),
      normal: gl.getUniformLocation(directionalShader, 'normal'),
      specular: gl.getUniformLocation(directionalShader, 'specular'),
      position: gl.getUniformLocation(directionalShader, 'position'),
      direction: gl.getUniformLocation(directionalShader, 'direction'),
      intensity: gl.getUniformLocation(directionalShader, 'intensity'),
      camPos: gl.getUniformLocation(directionalShader, 'camPos'),
    };

    // Point light fragment shader
    const pointSource = app.shaders.lightPoint;
    const point = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(point, pointSource);
    gl.compileShader(point);
    const pointShader = gl.createProgram();
    gl.attachShader(pointShader, vShader);
    gl.attachShader(pointShader, point);
    gl.linkProgram(pointShader);

    gl.useProgram(pointShader);
    shaders.lightPoint =
    {
      shader: pointShader,
      vpos: gl.getAttribLocation(pointShader, 'vpos'),
      diffuse: gl.getUniformLocation(pointShader, 'diffuse'),
      normal: gl.getUniformLocation(pointShader, 'normal'),
      specular: gl.getUniformLocation(pointShader, 'specular'),
      position: gl.getUniformLocation(pointShader, 'position'),
      lightPos: gl.getUniformLocation(pointShader, 'lightPos'),
      intensity: gl.getUniformLocation(pointShader, 'intensity'),
      camPos: gl.getUniformLocation(pointShader, 'camPos'),
      radius: gl.getUniformLocation(pointShader, 'radius'),
    };

    // console.log(`compilation error : ${gl.getShaderInfoLog(point)}`);

		// Fusion pass fragment shader
    const fusionSource = app.shaders.fusionFS;
    const fusion = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fusion, fusionSource);
    gl.compileShader(fusion);
    const fusionShader = gl.createProgram();
    gl.attachShader(fusionShader, vShader);
    gl.attachShader(fusionShader, fusion);
    gl.linkProgram(fusionShader);

    gl.useProgram(fusionShader);
    shaders.fusion =
    {
      shader: fusionShader,
      vpos: gl.getAttribLocation(fusionShader, 'vpos'),
      diffuse: gl.getUniformLocation(fusionShader, 'diffuse'),
      opaque: gl.getUniformLocation(fusionShader, 'opaque'),
      transparent: gl.getUniformLocation(fusionShader, 'transparent'),
      particle: gl.getUniformLocation(fusionShader, 'particle'),
      sColor: gl.getUniformLocation(fusionShader, 'skyColor'),
    };

		// HDR final pass fragment shader
    const hdrSource = app.shaders.hdrFS;
    const hdr = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(hdr, hdrSource);
    gl.compileShader(hdr);
    const hdrShader = gl.createProgram();
    gl.attachShader(hdrShader, vShader);
    gl.attachShader(hdrShader, hdr);
    gl.linkProgram(hdrShader);

    gl.useProgram(hdrShader);
    shaders.hdr =
    {
      shader: hdrShader,
      vpos: gl.getAttribLocation(hdrShader, 'vpos'),
      tex: gl.getUniformLocation(hdrShader, 'tex'),
    };


		// Vertex Shader for particles
    const particleVSSource = app.shaders.particleVS;
    const particleVS = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(particleVS, particleVSSource);
    gl.compileShader(particleVS);

		// Particle fragment shader
    const particleFSSource = app.shaders.particleFS;
    const particleFS = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(particleFS, particleFSSource);
    gl.compileShader(particleFS);
    const particleShader = gl.createProgram();
    gl.attachShader(particleShader, particleVS);
    gl.attachShader(particleShader, particleFS);
    gl.linkProgram(particleShader);

    gl.useProgram(particleShader);
    shaders.particle =
    {
      shader: particleShader,
      vpos: gl.getAttribLocation(particleShader, 'vpos'),
      cam: gl.getUniformLocation(particleShader, 'cam'),
      persp: gl.getUniformLocation(particleShader, 'persp'),
      pos: gl.getUniformLocation(particleShader, 'pos'),
      scale: gl.getUniformLocation(particleShader, 'scale'),
      texture: gl.getUniformLocation(particleShader, 'texture'),
      oldPos: gl.getUniformLocation(particleShader, 'oldPos'),
      camPos: gl.getUniformLocation(particleShader, 'camPos'),
      screenSize: gl.getUniformLocation(particleShader, 'screenSize'),
    };
  }

	//                 //
	//  ASSET RELEASE  //
	//                 //

	// Frees the textures used in the framebuffer
  function freeFramebuffer()	{
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
  function freeMesh(mesh)	{
    gl.deleteBuffer(meshes[mesh].buffer);
  }

	// Frees the requested texture
	// @param { string } texture - filepath of the texture to free
  function freeTexture(texture)	{
    gl.deleteTexture(textures[texture]);
  }

	// Frees the requested material
	// @param { string } material - name (filepath) of the material to free
  function freeMaterial(material)	{
    gl.deleteProgram(shaders[material].shader);
  }

	//             //
	//  SHADER IO  //
	//             //

	// Load and initialize all resources to be used
	// ONLY TO BE CALLED ONCE BY init
  function initResources()	{
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
  function drawMesh(renderable)	{
    if (!renderable) {
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, meshes[renderable.mesh].buffer);
    const v = meshes[renderable.mesh].count;
    const shader = shaders[renderable.material.shader];

    gl.useProgram(shader.shader);

    if (lastDrawnRenderable)		{
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

    const pmat = cameraMatrix;
    let wmat = fastMatrix;

    if (renderable.posOnly)		{
      wmat[12] = renderable.transform.position.elements[0];
      wmat[13] = renderable.transform.position.elements[1];
      wmat[14] = renderable.transform.position.elements[2];
    }		else		{
      wmat = translationMatrix(renderable.transform.position);
      wmat = wmat.multiply(rotationMatrix(renderable.transform.rotation));
      wmat = wmat.multiply(scaleMatrix(renderable.transform.scale));
      wmat = flattenMatrix(wmat);
    }

		// Set the matrix uniforms
    gl.uniformMatrix4fv(shader.puni, false, pmat);
    gl.uniformMatrix4fv(shader.wuni, false, wmat);

    gl.uniform4f(gl.getUniformLocation(shader.shader, 'camPos'),
      activeCamera.transform.position.elements[0],
      activeCamera.transform.position.elements[1],
      activeCamera.transform.position.elements[2],
      activeCamera.transform.position.elements[3]);

		// Texture

		// Set material uniforms
    for (let i = 0; i < renderable.material.textures.length; ++i)		{
      if (renderable.material.textures[i].uni)			{
        gl.activeTexture(glTextureBinds[i]);
        gl.bindTexture(gl.TEXTURE_2D, textures[renderable.material.textures[i].val]);

        gl.uniform1i(renderable.material.textures[i].uni, i);
      }
    }

		// Set vector uniforms
    for (let i = 0; i < renderable.material.vectors.length; ++i)		{
      if (renderable.material.vectors[i].uni)			{
        gl.uniform4f(renderable.material.vectors[i].uni,
          renderable.material.vectors[i].val.elements[0],
          renderable.material.vectors[i].val.elements[1],
          renderable.material.vectors[i].val.elements[2],
          renderable.material.vectors[i].val.elements[3]);
      }
    }

		// Set float uniforms
    for (let i = 0; i < renderable.material.floats.length; ++i)		{
      if (renderable.material.floats[i].uni)			{
        gl.uniform1f(renderable.material.floats[i].uni, renderable.material.floats[i].val);
      }
    }

		// ext.dbuffer.drawBuffersWEBGL([gl.BACK]);
		// gl.drawArrays(gl.TRIANGLES, 0, v);

    ext.dbuffer.drawBuffersWEBGL([
      ext.dbuffer.COLOR_ATTACHMENT0_WEBGL,
      ext.dbuffer.COLOR_ATTACHMENT1_WEBGL,
      ext.dbuffer.COLOR_ATTACHMENT2_WEBGL,
      ext.dbuffer.COLOR_ATTACHMENT3_WEBGL,
      ext.dbuffer.COLOR_ATTACHMENT4_WEBGL,
    ]);
    gl.drawArrays(gl.TRIANGLES, 0, v);
  }

	// Called to draw a particle renderable
	// Once deferred shading is implemented, this will have to happen only after all the mesh renderables are done being drawn, as particles will use optimized forward shading
	// ONLY TO BE CALLED BY draw
	// TODO : Implement
  function drawParticles(index)	{
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

    gl.uniform3f(shaders.particle.camPos,
      activeCamera.transform.position.elements[0],
      activeCamera.transform.position.elements[1], activeCamera.transform.position.elements[2]);

    gl.uniform2f(shaders.particle.screenSize, glCanvas.width, glCanvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, framebuffer.textures.position);
    gl.uniform1i(shaders.particle.oldPos, 0);

		// And draw the particles
    for (let i = 0; i < particles.length; ++i)		{
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
  function drawShadingPass()	{
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

    for (let i = 0; i < directionalLights.length; ++i)		{
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

    for (let i = 0; i < pointLights.length; ++i) {
      gl.uniform4f(shaders.lightPoint.lightPos, pointLights[i].position.elements[0] || 0.0, pointLights[i].position.elements[1] || 0.0, pointLights[i].position.elements[2] || 0.0, 1.0);

      gl.uniform4f(shaders.lightPoint.intensity, pointLights[i].intensity.elements[0] || 0.5, pointLights[i].intensity.elements[1] || 0.5, pointLights[i].intensity.elements[2] || 0.5, 1.0);

      gl.uniform4f(shaders.lightPoint.camPos, activeCamera.transform.position.elements[0] || 0.0, activeCamera.transform.position.elements[1] || 0.0, activeCamera.transform.position.elements[2] || 0.0, 1.0);

      gl.uniform1f(shaders.lightPoint.radius, pointLights[i].radius);

      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
  }

	// Fuses the opaque and transparent framebuffers
  function drawFusionPass()	{
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
  function drawFinalPass()	{
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
  function init(x, y)	{
		// Fetch both canvases
    glCanvas = document.querySelector('#glCanvas');
    txCanvas = document.querySelector('#txCanvas');

		// Attempt to initalize the WebGL context, will abort if this fails
    gl = glCanvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!(gl)) { /* console.log("WebGL failed to initialize.");*/ return; }

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

    fastMatrix = new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ]);

    gl.clearColor(0.06, 0.06, 0.12, 1.0);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
		// Why is FRONT_AND_BACK an option.
    gl.cullFace(gl.BACK);
    clear();
  }

	// Clears the text canvas
  function clear()	{
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
  function resize(x, y)	{
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
  function draw(dt)	{
		// Setup for rendering
    generateCameraMatrix();
    lastDrawnRenderable = null;

		// Update all the particle systems
    for (let i = 0; i < particleSystems.length; ++i)		{
      const part = particleSystems[i].spawn(dt);

      if (part)			{
        part.position = part.position.add(particleSystems[i].transform.position);

        particles.push(part);
      }
    }

		// Update all particles
    for (let i = 0; i < particles.length; ++i)		{
      particles[i].velocity.elements[0] += particles[i].accel.elements[0] * dt;
      particles[i].velocity.elements[1] += particles[i].accel.elements[1] * dt;
      particles[i].velocity.elements[2] += particles[i].accel.elements[2] * dt;

      particles[i].position.elements[0] += particles[i].velocity.elements[0] * dt;
      particles[i].position.elements[1] += particles[i].velocity.elements[1] * dt;
      particles[i].position.elements[2] += particles[i].velocity.elements[2] * dt;
    }

		// Sort the particles
    particles.sort(particleSort);

		// Remove dead particles
    for (let i = particles.length - 1; i >= 0; --i)		{
      particles[i].time += dt;

      if (particles[i].time > particles[i].life)			{
        particles.splice(i, 1);
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

    for (let i = 0; i < renderables.length; ++i)		{
      drawMesh(renderables[i]);
      lastDrawnRenderable = renderables[i];
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

    for (let i = 0; i < transparents.length; ++i)		{
      drawMesh(transparents[i]);
      lastDrawnRenderable = transparents[i];
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
  function drawText(string, x, y, css, color)	{
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
  function createMeshRenderable(descriptor)	{
    return new MeshRenderable(descriptor);
  }
  MeshRenderable = function (descriptor)	{
		// Give the renderable its own transform to be manipulated by the game and used in rendering
    this.transform =
    {
      position: descriptor.position || Vector.create([0, 0, 0]),
      rotation: descriptor.rotation || Vector.create([0, 0, 0]),
      scale: descriptor.scale || Vector.create([1, 1, 1]),
    };

    this.posOnly = descriptor.posOnly || false;
    this.opaque = descriptor.opaque !== false;

		// Name of the mesh; will be mapped to the actual mesh within the rendering engine later
    this.mesh = descriptor.mesh || 'assets/meshes/cube.obj';

		// The material will contain the shader to use, associated textures, and possibly more
    this.material =
    {
      shader: descriptor.shader || 'defaultMaterial',
      textures: [],
      vectors: [],
      floats: [],
      texLocs: {},
      vecLocs: {},
      floLocs: {},
    };

		// Object-oriented functionality!
    this.register = function () { registerRenderable(this); };
    this.unregister = function () { unregisterRenderable(this); };

		// Setting and getting uniform "material properties"

		// Sets the requested texture uniform in the material to the provided texture - returns true if successful
		// @param { string } uniform - name of the uniform in the material
		// @param { string } texture - name of the texture (file path) to set
    this.setTexture = function (uniform, texture)		{
			// If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].txUnis)) { return false; }

      const uni = shaders[this.material.shader].txUnis[uniform];

      if (uniform in this.material.texLocs)			{
        this.material.textures[this.material.texLocs[uniform]] = { uni, val: texture };
      }			else			{
        this.material.texLocs[uniform] = this.material.textures.length;
        this.material.textures.push({ uni, val: texture });
      }

      return true;
    };

		// Gets the texture currently set as the provided material texture
		// @param { string } uniform - name of the uniform in the material
    this.getTexture = function (uniform)		{
			// If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].txUnis)) { return null; }

      return this.material.textures[this.material.texLocs[uniform]];
    };

		// Sets the requested vector uniform in the material to the provided vector - returns true if successful
		// @param { string } uniform - name of the uniform in the material
		// @param { Vector } vector - vector to set
    this.setVector = function (uniform, vector)		{
			// If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].v4Unis)) { return false; }

      const uni = shaders[this.material.shader].v4Unis[uniform];
      const vec = Vector.create([vector.elements[0] || 0.0, vector.elements[1] || 0.0, vector.elements[2] || 0.0, vector.elements[3] || 0.0]);

      if (uniform in this.material.vecLocs)			{
        this.material.vectors[this.material.vecLocs[uniform]] = { uni, val: vec };
      }			else			{
        this.material.vecLocs[uniform] = this.material.vectors.length;
        this.material.vectors.push({ uni, val: vec });
      }

      return true;
    };

		// Gets the vector currently set as the provided material vector
		// @param { string } uniform - name of the uniform in the material
    this.getVector = function (uniform)		{
			// If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].v4Unis)) { return null; }

      return this.material.vectors[this.material.vecLocs[uniform]];
    };

		// Sets the requested float uniform in the material to the provided float - returns true if successful
		// @param { string } uniform - name of the uniform in the material
		// @param { number } float - float to set
    this.setFloat = function (uniform, float)		{
			// If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].flUnis)) { return false; }

      const uni = shaders[this.material.shader].flUnis[uniform];

      if (uniform in this.material.floLocs)			{
        this.material.floats[this.material.floLocs[uniform]] = { uni, val: float };
      }			else			{
        this.material.floLocs[uniform] = this.material.floats.length;
        this.material.floats.push({ uni, val: float });
      }

      return true;
    };

		// Gets the float currently set as the provided material float
		// @param { string } uniform - name of the uniform in the material
    this.getFloat = function (uniform, float)		{
			// If it is not a valid uniform, ignore and return
      if (!(uniform in shaders[this.material.shader].flUnis)) { return null; }

      return this.material.floats[this.material.floLocs[uniform]];
    };

    for (let i = 0; i < shaders[this.material.shader].txs.length; ++i)		{
      let tex = 'assets/textures/nothing.png';
      if (descriptor.textures)			{
        tex = descriptor.textures[shaders[this.material.shader].txs[i]] || tex;
      }
      this.setTexture(shaders[this.material.shader].txs[i], tex);
    }

    for (let i = 0; i < shaders[this.material.shader].v4s.length; ++i)		{
      let vec = Vector.create([0.0, 0.0, 0.0, 0.0]);
      if (descriptor.vectors)			{
        vec = descriptor.vectors[shaders[this.material.shader].v4s[i]] || vec;
      }
      this.setVector(shaders[this.material.shader].v4s[i], vec);
    }

    for (let i = 0; i < shaders[this.material.shader].fls.length; ++i)		{
      let float = 0.0;
      if (descriptor.floats)			{
        float = descriptor.floats[shaders[this.material.shader].fls[i]] || float;
      }
      this.setFloat(shaders[this.material.shader].fls[i], float);
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
  ParticleRenderable = function (descriptor)	{
    this.transform = {};
    this.transform.position = descriptor.position || $V([0.0, 0.0, 0.0]);

    this.timeToSpawn = 0.25;

    this.spawn = descriptor.spawn || function (dt)		{
      this.timeToSpawn -= dt;

      if (this.timeToSpawn <= 0.0)			{
        this.timeToSpawn = Math.random() / 10.0 + 0.1;

        const texChance = Math.random();
        let texString = '';

        if (texChance < 0.34)				{
          texString = 'assets/textures/particleSmoke.png';
        }				else if (texChance < 0.67)				{
          texString = 'assets/textures/particleFire1.png';
        }				else				{
          texString = 'assets/textures/particleFire2.png';
        }

        return new Particle({
          position: $V([Math.random() / 16.0 - 0.0625, Math.random() / 16.0 - 0.0625, Math.random() / 16.0 - 0.0625]),
          velocity: $V([Math.random() / 16.0 - 0.0625, Math.random() / 16.0 + 0.0625, Math.random() / 16.0 - 0.0625]),
          accel: $V([0.0, 0.25, 0.0]),
          scale: $V([0.2, 0.2, 0.2]),
          life: Math.random() + 1.0,
          texture: texString,
        });
      }

      return null;
    };

		// Object-oriented functionality!
    this.register = function () { registerRenderable(this); };
    this.unregister = function () { unregisterRenderable(this); };

    this.rtype = 'particle';
    this.rindex = -1;
  };
  function createParticleRenderable(descriptor)	{
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
  Particle = function (descriptor)	{
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
  PointLight = function (descriptor) {
    this.position = descriptor.position || $V([0.0, 0.0, 0.0]);
    this.intensity = descriptor.intensity || $V([0.5, 0.5, 0.5]);
    this.radius = descriptor.radius || 10.0;

    this.register = function () { registerLight(this); };
    this.unregister = function () { unregisterLight(this); };

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
  function createDirectionalLight(descriptor)	{
    return new DirectionalLight(descriptor);
  }
  DirectionalLight = function (descriptor)	{
    this.direction = descriptor.direction || $V([0.0, -1.0, 0.0]);
    this.intensity = descriptor.intensity || $V([0.5, 0.5, 0.5]);

    this.register = function () { registerLight(this); };
    this.unregister = function () { unregisterLight(this); };

    this.ltype = 'directional';
    this.lindex = -1;
  };

	// Registers a renderable to be drawn every frame until unregistered
  function registerRenderable(renderable)	{
		// Abort if it is already registered
    if (renderable.rindex != -1) { return; }

    if (renderable.rtype == 'mesh' && renderable.opaque)		{
      renderable.rindex = renderables.length;
      renderables.push(renderable);
    }		else if (renderable.rtype == 'mesh')		{
      renderable.rindex = transparents.length;
      transparents.push(renderable);
    }		else		{
      renderable.rindex = particleSystems.length;
      particleSystems.push(renderable);
    }
  }

	// Removes a renderable from the list to be rendered every frame
  function unregisterRenderable(renderable)	{
		// Just to be safe
    if (renderable.rindex == -1) { return; }

    if (renderable.opaque)		{
      renderables[renderable.rindex] = renderables.pop();
      renderable.rindex = -1;
    }		else		{
      transparents[renderable.rindex] = transparents.pop();
      renderable.rindex = -1;
    }
  }

	// Registers a light to be drawn every frame until unregistered
  function registerLight(light)	{
		// Abort if it is already registered
    if (light.lindex != -1) { return; }

    switch (light.ltype)		{
      case 'directional' :
        light.lindex = directionalLights.length;
        directionalLights.push(light);
        break;
      case 'point' :
        light.lindex = pointLights.length;
        pointLights.push(light);
        break;
    }
  }

	// Removes a light from the list to be rendered every frame
  function unregisterLight(light)	{
		// Just to be safe
    if (light.lindex == -1) { return; }

    switch (light.ltype)		{
      case 'directional' :
        directionalLights[light.lindex] = directionalLights.pop();
        light.lindex = -1;
        break;
      case 'point' :
        pointLights[light.lindex] = pointLights.pop();
        light.lindex = -1;
        break;
    }
  }

	// Controls for ambient lighting, use Vectors
  function getAmbient()	{
    return $V([ambientIntensity[0], ambientIntensity[1], ambientIntensity[2]]);
  }
  function setAmbient(intensity)	{
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
  PerspectiveCamera = function (descriptor)	{
    this.transform = {};

    this.transform.position = descriptor.position || Vector.create([0, 0, 0]);
    this.transform.rotation = descriptor.rotation || Vector.create([0, 0, 0]);

    this.fov = descriptor.fov || 50.0 * Math.PI / 180.0;
    this.znear = descriptor.znear || 0.1;
    this.zfar = descriptor.zfar || 200.0;

    this.setActive = function () { setActiveCamera(this); };
    this.isActive = function () { return getActiveCamera() == this; };

    this.ctype = 'perspective';
  };
  function createPerspectiveCamera(descriptor)	{
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
  OrthogonalCamera = function (descriptor)	{
    this.transform = {};

    this.transform.position = descriptor.position || Vector.create([0, 0, 0]);
    this.transform.rotation = descriptor.rotation || Vector.create([0, 0, 0]);

    this.size = descriptor.size || 5.0;
    this.znear = descriptor.znear || 0.1;
    this.zfar = descriptor.zfar || 80.0;

    this.setActive = function () { setActiveCamera(this); };
    this.isActive = function () { return getActiveCamera() == this; };

    this.ctype = 'orthogonal';
  };
  function createOrthogonalCamera(descriptor)	{
    return new OrthogonalCamera(descriptor);
  }

	// Returns the camera currently being used for rendering
  function getActiveCamera()	{
    return activeCamera;
  }

	// Sets the camera used in rendering to the provided camera
	// @param { object } camera - the camera object to set as the active camera
  function setActiveCamera(camera)	{
    activeCamera = camera;
  }

	//            //
	//  ASSET IO  //
	//            //

	// Load a mesh into the meshes map to be used later - automatically calls initMesh
	// @param { string } mesh - the file path of the mesh to load
  function loadMesh(mesh)	{
		// Load up the file, looks like we're doing this all manually
    const xhr = new XMLHttpRequest();

		// In here the actual mesh loading will occur
    xhr.onload = function ()		{
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
  function initMesh(mesh, name)	{
		// Split the text into lines for easy iteration
    const lines = mesh.split('\n');

    const vp = [];
    const vt = [];
    const vn = [];
    const faces = [];

    for (let i = 0; i < lines.length; ++i)		{
			// Split each line into its core components
      const chunks = lines[i].split(' ');

			// Check the label to determine what data is on the line
      switch (chunks[0])			{
        case 'v' :
          vp.push(parseFloat(chunks[1]));
          vp.push(parseFloat(chunks[2]));
          vp.push(parseFloat(chunks[3]));
          break;
        case 'vt' :
          vt.push(parseFloat(chunks[1]));
          vt.push(parseFloat(chunks[2]));
          break;
        case 'vn' :
          vn.push(parseFloat(chunks[1]));
          vn.push(parseFloat(chunks[2]));
          vn.push(parseFloat(chunks[3]));
          break;
        case 'f' :
          const f1 = chunks[1].split('/');
          const f2 = chunks[2].split('/');
          const f3 = chunks[3].split('/');

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
    createMesh({ vp, vt, vn, faces }, name);
  }

  function createMesh(meshData, name) {
    const vp = meshData.vp;
    const vt = meshData.vt;
    const vn = meshData.vn;
    const faces = meshData.faces;

    // Subtract one from all faces because reasons
    for (let i = 0; i < faces.length; i++) {
      faces[i] -= 1;
    }

    const dataBuffer = new Float32Array(faces.length * 8);
    const vpStart = 0;
    const vtStart = vpStart + faces.length * 3;
    const vnStart = vtStart + faces.length * 2;

    let face = null;

		// Boy howdy, look at them numbers
		// We got some real number crunchin' goin' on right here, we do
    for (let i = 0; i < faces.length / 3; ++i) {
      face = faces[i * 3 + 0];
      dataBuffer[i * 3 + 0 + vpStart] = (vp[face * 3 + 0]);
      dataBuffer[i * 3 + 1 + vpStart] = (vp[face * 3 + 1]);
      dataBuffer[i * 3 + 2 + vpStart] = (vp[face * 3 + 2]);

      face = faces[i * 3 + 1];
      dataBuffer[i * 2 + 0 + vtStart] = (vt[face * 2 + 0]);
      dataBuffer[i * 2 + 1 + vtStart] = (vt[face * 2 + 1]);

      face = faces[i * 3 + 2];
      dataBuffer[i * 3 + 0 + vnStart] = (vn[face * 3 + 0]);
      dataBuffer[i * 3 + 1 + vnStart] = (vn[face * 3 + 1]);
      dataBuffer[i * 3 + 2 + vnStart] = (vn[face * 3 + 2]);
    }

    const glBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, glBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(dataBuffer), gl.STATIC_DRAW);

		// Whew, finally done; time to never look at this again
    meshes[name] =
    {
      buffer: glBuffer,
      count: (dataBuffer.length / 8),
    };
  }

	// Load a texture into the textures map to be used later
	// @param { string } tex - the file path of the texture to load
  function loadTexture(tex)	{
    const image = new Image();
    image.onload = function () { initTexture(image, tex); };
    image.src = tex;
  }

	// Push a loaded texture into the textures map to be used later
	// @param { Image } tex - the loaded image object to initialize for rendering
	// @param { string } name - the name for the texture to be saved as (usually the file path)
  function initTexture(tex, name)	{
    const glTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, glTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, tex);

		// What a life-saver this extension is
    if (ext.aniso)		{
      const max = gl.getParameter(ext.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
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
  function loadMaterial(mat)	{
    const xhr = new XMLHttpRequest();
    xhr.onload = function ()		{
      initMaterial(xhr.responseText, mat);
    };

    xhr.open('GET', mat, true);
    xhr.setRequestHeader('If-Modified-Since', 'Thu, 1 Jan 1970 00:00:00 GMT');
    xhr.send();
  }

	// Compile a loaded material into a shader
	// @param { string } mat - the material string to initialize for rendering
	// @param { string } name - the name for the material to be saved as (usually the file path)
  function initMaterial(mat, name)	{
		// Vertex Shader
    const vShaderSource = app.shaders.vertexShader;
    const vShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vShader, vShaderSource);
    gl.compileShader(vShader);

		// Fragment Shader - preMaterial + material + postMaterial
    const fShaderSource = app.shaders.preMaterial + mat + app.shaders.postMaterial;
    const fShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fShader, fShaderSource);
    gl.compileShader(fShader);

		// Make sure it compiled correctly
    if (!gl.getShaderParameter(fShader, gl.COMPILE_STATUS))		{
			// console.log("Shader \"" + mat + "\" compilation error : " + gl.getShaderInfoLog(fShader));
      gl.deleteShader(fShader);
      return;
    }

    const shader = gl.createProgram();
    gl.attachShader(shader, vShader);
    gl.attachShader(shader, fShader);
    gl.linkProgram(shader);

		// Make sure the shader linked correctly
    if (!gl.getProgramParameter(shader, gl.LINK_STATUS))		{
			// console.log("Shader for material \"" + mat + "\"failed to initialize.");
			// console.error(gl.getProgramInfoLog(shader));
    }

    gl.useProgram(shader);

		// Fetch attribute locations
    const vpos = gl.getAttribLocation(shader, 'vpos');
    const vtex = gl.getAttribLocation(shader, 'vtex');
    const vnor = gl.getAttribLocation(shader, 'vnor');

		// Fetch matrix uniform locations
    const puni = gl.getUniformLocation(shader, 'persp');
    const wuni = gl.getUniformLocation(shader, 'world');

		// Find and link all the material uniforms
    const txUnis = {};
    const flUnis = {};
    const v4Unis = {};

		// Arrays of all material uniforms
    const txs = [];
    const fls = [];
    const v4s = [];

		// HERE is where I can change it to include uniforms from other parts of the shader
    const lines = mat.split('\n');
    for (let i = 0; i < lines.length; ++i)		{
      const chunks = lines[i].split(' ');

			// Only bother going through if this line is a uniform
      if (chunks[0] != 'uniform') { continue; }

			// Slice that semicolon off the edge
      const uni = chunks[2].slice(0, -1);

      switch (chunks[1])			{
        case 'sampler2D' :
          txUnis[uni] = gl.getUniformLocation(shader, uni);
          txs.push(uni);
          break;
        case 'vec4' :
          v4Unis[uni] = gl.getUniformLocation(shader, uni);
          v4s.push(uni);
          break;
        case 'float' :
          flUnis[uni] = gl.getUniformLocation(shader, uni);
          fls.push(uni);
          break;
      }
    }

    shaders[name] =
    {
      shader,

      vpos,
      vtex,
      vnor,

      puni,
      wuni,

      txUnis,
      flUnis,
      v4Unis,

      txs,
      v4s,
      fls,
    };
  }

  function skyColor()	{
    return sColor;
  }

	//          //
	//  RETURN  //
	//          //

  return {
    init,
    clear,
    resize,
    draw,
    drawText,

    createMeshRenderable,
    createParticleRenderable,
    registerRenderable,
    unregisterRenderable,

    createPointLight,
    createDirectionalLight,
    registerLight,
    unregisterLight,

    getAmbient,
    setAmbient,

    createPerspectiveCamera,
    createOrthogonalCamera,

    getActiveCamera,
    setActiveCamera,

    loadMesh,
    initMesh,
    createMesh,
    loadTexture,
    initTexture,
    loadMaterial,
    initMaterial,
    freeMesh,
    freeTexture,
    freeMaterial,

    skyColor,
  };
}());
