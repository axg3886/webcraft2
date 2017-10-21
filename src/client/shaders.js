

var app = app || {};

app.shaders = (function () {
	// Manipulates the vertices and sets up for the material shader
  const vertexShader = `
attribute vec3 vpos;
attribute vec2 vtex;
attribute vec3 vnor;

uniform mat4 world;
uniform mat4 persp;

varying vec3 pos;
varying vec2 uv;
varying vec3 norm;

void main(void)
{
	pos = vec3(world * vec4(vpos, 1.0));
	uv = vtex;
	norm = normalize(vec3(world * vec4(vnor, 0.0)));

	gl_Position = persp * world * vec4(vpos, 1.0);
}
`;

	// Sets the shader up for the material calculation
  const preMaterial = `
#extension GL_EXT_draw_buffers : require
precision mediump float;

varying vec3 pos;
varying vec2 uv;
varying vec3 norm;

vec3 diffuse = vec3(0.5);
vec3 normal = vec3(0.0, 0.0, 1.0);
vec3 specular = vec3(0.5);
vec3 emission = vec3(0.0);
float roughness = 0.5;
float opacity = 1.0;
`;

	// Interprets the results of the material
  const postMaterial = `
uniform vec4 camPos;

// float fogStart = 64.0;
// float fogEnd = 80.0;

void main(void)
{
	material();


	// float dist = length(vec3(camPos) - pos);
	// float fog = (dist - fogStart) / (fogEnd - fogStart);
	// fog = clamp(fog, 0.0, 1.0);


	gl_FragData[0] = vec4(diffuse, opacity);

	gl_FragData[1] = vec4(norm, 0.0);

	gl_FragData[2] = vec4(specular, roughness);

	gl_FragData[3] = vec4(emission, 1.0);

	gl_FragData[4] = vec4(pos, 1.0);
}
`;

	// Creates the material function which serves as the "meat" of the material
  const defaultMaterial = `
uniform sampler2D diffuseTexture;
uniform sampler2D specularTexture;
uniform sampler2D emissionTexture;

void material(void)
{
	vec4 dTex = texture2D(diffuseTexture, uv);
	vec4 sTex = texture2D(specularTexture, uv);
	vec4 eTex = texture2D(emissionTexture, uv);


	diffuse = dTex.rgb;
	opacity = dTex.a;
	specular = sTex.rgb;
	roughness = sTex.a;
	emission = eTex.rgb;
}
`;

	// Simple vertex shader for lights
  const lightVertex = `
attribute vec3 vpos;

varying vec2 uv;

void main(void)
{
	uv = vec2((vpos + vec3(1.0)) / 2.0);
	gl_Position = vec4(vpos, 1.0);
}
`;

	// Sets the emission value
  const lightPrepass = `
precision mediump float;

uniform sampler2D emission;

varying vec2 uv;

void main(void)
{
	gl_FragData[0] = texture2D(emission, uv);
}
`;

	// Ambient light pass
  const lightAmbient = `
precision mediump float;

uniform sampler2D diffuse;

uniform vec4 intensity;

varying vec2 uv;

void main(void)
{
	vec4 dtex = texture2D(diffuse, uv);
	gl_FragData[0] = vec4(intensity.rgb * dtex.rgb, dtex.a);
}
`;

  const lightDirectional = `
precision mediump float;

uniform sampler2D diffuse;
uniform sampler2D normal;
uniform sampler2D specular;
uniform sampler2D position;

uniform vec4 direction;
uniform vec4 intensity;
uniform vec4 camPos;

varying vec2 uv;

void main(void)
{
	vec3 opDir = -vec3(direction);

	vec4 dtex = texture2D(diffuse, uv);

	// DIFFUSE

	vec3 normTex = texture2D(normal, uv).rgb;
	float diff = max(dot(normTex, opDir), 0.0);
	vec3 diffuseIntensity = (intensity * diff).rgb * dtex.rgb;

	// SPECULAR

	vec3 fragPos = texture2D(position, uv).rgb;
	vec3 viewDir = normalize(vec3(camPos) - fragPos);
	vec3 reflectDir = reflect(vec3(direction), normTex);
	vec4 specTex = texture2D(specular, uv);
	float spec = pow(max(dot(viewDir, reflectDir), 0.0), 2.0 / max(specTex.a * specTex.a, 0.01));
	vec3 specularIntensity = (intensity.rgb * spec) * specTex.rgb;

	gl_FragData[0] = vec4(diffuseIntensity + specularIntensity, dtex.a);
}
`;

	// Renders particles
  const particleVS = `
attribute vec3 vpos;

uniform mat4 cam;
uniform mat4 persp;

uniform vec4 pos;
uniform vec2 scale;

varying vec2 uv;
varying vec3 newPos;

void main(void)
{
	uv = vec2((vpos + vec3(1.0)) / 2.0);

	vec3 vertPos = vec3((vpos.xy * scale.xy) * 0.1, vpos.z);

	newPos = pos.xyz;

	vec3 tempPos = vec3(cam * pos);
	tempPos += vertPos;

	vec4 finalPos = persp * vec4(tempPos, 1.0);

	gl_Position = finalPos;
}
`;

	// Also renders particles
  const particleFS = `
precision mediump float;

uniform sampler2D texture;
uniform sampler2D oldPos;

uniform vec3 camPos;
uniform vec2 screenSize;

varying vec2 uv;
varying vec3 newPos;

// Get the length-squared, as it is faster
float lsq(vec3 vector)
{
	return (vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
}

void main(void)
{
	vec2 screenUV = gl_FragCoord.xy / screenSize;

	vec4 tex = texture2D(texture, uv);
	vec3 posTex = texture2D(oldPos, screenUV).xyz;

	float oldDist = lsq(posTex - camPos);
	float newDist = lsq(newPos - camPos);

	if (newDist > oldDist) { discard; }

	gl_FragData[0] = tex;
}
`;

	// Fuses the opaque and transparent framebuffers
  const fusionFS = `
precision mediump float;

uniform sampler2D opaque;
uniform sampler2D transparent;
uniform sampler2D diffuse;
uniform sampler2D particle;

uniform vec3 skyColor;

varying vec2 uv;

void main(void)
{
	vec4 opaqueTex = texture2D(opaque, uv);
	vec4 transparentTex = texture2D(transparent, uv);
	vec4 diffuseTex = texture2D(diffuse, uv);
	vec4 partTex = texture2D(particle, uv);

	float oa = opaqueTex.a;
	oa = clamp(oa, 0.0, 1.0);
	float alpha = diffuseTex.a;
	float pa = partTex.a;

	// Who needs built-in blending when you have the power of poor shader design
	vec4 result = opaqueTex * oa + vec4(skyColor * (1.0 - oa), 1.0);
	result = vec4(vec3(transparentTex) * alpha + vec3(result) * (1.0 - alpha), 1.0);
	gl_FragData[0] = vec4(vec3(partTex) * pa + vec3(result) * (1.0 - pa), 1.0);
}
`;

	// TODO : Implement
  const hdrFS = `
precision mediump float;

uniform sampler2D tex;

varying vec2 uv;

void main(void)
{
	gl_FragColor = texture2D(tex, uv);
}
`;

  return {
    vertexShader,
    preMaterial,
    postMaterial,
    defaultMaterial,

    lightVertex,
    lightPrepass,
    lightAmbient,
    lightDirectional,

    particleVS,
    particleFS,

    fusionFS,
    hdrFS,
  };
}());
