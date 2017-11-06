
var app = app || {};

app.network = (function () {

  const onMessage = (socket) => socket.on('genMsg', (data) => {
    if (app.main.gameState !== app.main.GAME_STATE.LOADING) {
      app.main.updateRequired = true;
      return;
    }
    app.main.genMessage = data.genMessage;
    app.main.genStr = data.genStr;
    app.main.genPercent = data.genPercent;
  });

  const onMeshData = (socket) => socket.on('meshData', (data) => {
    if (app.main.gameState !== app.main.GAME_STATE.LOADING) {
      return;
    }
    const meshData = data.meshData;

    for (let i = 0; i < meshData.str.length; i++) {
      const tex = `chunk${meshData.chunkIndex}-${i}`;
      app.main.graphics.createMesh(meshData.str[i], tex);
      const mesh = new MeshRenderable({
        textures: app.main.standardTextures,
        mesh: tex,
        posOnly: true,
        opaque: i !== 0,
        position: $V([meshData.chunkX, 0, meshData.chunkZ]),
      });
      mesh.register();
      app.main.chunkMeshData.push(mesh);
    }

    if (data.finished) {
      app.main.gameState = app.main.GAME_STATE.BEGIN;
    }
  });

  const timeUpdate = (socket) => socket.on('timeUpdate', (data) => {
    app.main.worldTime = data.time;
  });

  const update = (socket) => socket.on('update', (data) => {
    let entity = app.main.entityList[data.id];

    if (!entity) {
      entity = app.main.entityList[data.id] = data;
      entity.pos = app.main.convertVector(data.pos);
      entity.rot = app.main.convertVector(data.rot);

      if (data.selfUser) {
        entity.mesh = app.main.graphics.getActiveCamera();
        app.main.user = entity;
      } else {
        entity.mesh = new MeshRenderable({
          mesh: 'assets/meshes/cube.obj',
          position: $V([data.pos.x, data.pos.y, data.pos.z]),
        });
        entity.mesh.register();
      }

      entity.updateMesh = () => {
        entity.mesh.transform.position.elements[0] = entity.pos.x;
        entity.mesh.transform.position.elements[1] = entity.pos.y;
        entity.mesh.transform.position.elements[2] = entity.pos.z;
        entity.mesh.transform.rotation.elements[0] = entity.rot.x;
        entity.mesh.transform.rotation.elements[1] = entity.rot.y;
        entity.mesh.transform.rotation.elements[2] = entity.rot.z;
      };

      entity.torchParticle = new ParticleRenderable({});
      entity.torchParticle.register();

      entity.torch = new MeshRenderable({
        scale: $V([0.05, 0.4, 0.05]),
        rotation: $V([-0.2, 0.0, 0.2]),
        textures: {
          diffuseTexture: 'assets/textures/torchDiffuse.png',
          emissionTexture: 'assets/textures/torchEmission.png',
        },
      });
      entity.torch.register();

      entity.torchLight = new PointLight({ intensity: $V([0.6, 0.5, 0.3]), radius: 20.0 });
      entity.torchLight.register();

      return;
    }

    if (entity.lastUpdate >= data.lastUpdate) {
      return;
    }

    entity.lastUpdate = data.lastUpdate;
    entity.pos = app.main.convertVector(data.pos);
    entity.rot = app.main.convertVector(data.rot);
    entity.onGround = data.onGround;
    entity.alpha = 0;
  });

  const kill = (socket) => socket.on('kill', (data) => {
    app.main.entityList[data.id].mesh.unregister();
    app.main.entityList[data.id].torch.unregister();
    app.main.entityList[data.id].torchParticle.unregister();
    app.main.entityList[data.id].torchLight.unregister();
    app.main.graphics.unregisterRenderable(app.main.entityList[data.id].mesh);
    app.main.entityList[data.id] = {};
  });


  const handleConnection = (socket) => socket.on('connect', () => {
    onMessage(socket);
    onMeshData(socket);
    timeUpdate(socket);
    update(socket);
    kill(socket);
    socket.emit('join', { name: `Player${Math.floor(Math.random() * 100)}` });
  });

  return {
    handleConnection,
  };
}());
