/* globals io */ // Socket.io
/* globals MeshRenderable ParticleRenderable PointLight $V */ // Graphics

const app = window.app || {};

app.network = app.network || (function func() {
  // Global socket object
  let genWorker = undefined;

  const entityList = {};
  let user = undefined;
  let world = undefined;

  const getSendingUser = () => {
    const e = {
      pos: user.pos,
      rot: user.rot,
      onGround: user.onGround,
      lastUpdate: user.lastUpdate,
    };
    return e;
  };

  const convertVector = (input) => {
    const ref = input;
    ref.updatePrev = () => {
      ref.prevX = ref.x;
      ref.prevY = ref.y;
      ref.prevZ = ref.z;
    };
    ref.lerp = (alpha) => {
      ref.x = window.lerp(ref.prevX, ref.destX, alpha);
      ref.y = window.lerp(ref.prevY, ref.destY, alpha);
      ref.z = window.lerp(ref.prevZ, ref.destZ, alpha);
    };
    return ref;
  };

  const createFakeVector = (x, y, z) => {
    const e = {
      x,
      y,
      z,
      prevX: x,
      prevY: y,
      prevZ: z,
      destX: x,
      destY: y,
      destZ: z,
    };
    return e;
  };

  const updateEntity = () => {
    if (!world) {
      return;
    }
    // Player position correction
    const prev = convertVector(createFakeVector(user.pos.x, user.pos.y, user.pos.z));

    // Entity update
    const keys = Object.keys(entityList);
    for (let i = 0; i < keys.length; i++) {
      const entity = entityList[keys[i]];

      if (!entity.pos) {
        continue;
      }

      // Update alpha
      if (entity.alpha < 1) {
        entity.alpha += 0.05;
      }

      // Lerp position
      entity.pos.lerp(entity.alpha);
      entity.pos.y = Math.max(0, entity.pos.y);
      entity.rot.lerp(entity.alpha);

      if (entity === user) {
        const pos = app.worldDefs.correctPosition(world, user.pos, prev);
        user.onGround = pos.y === user.pos.y || pos.y <= 0;
        user.pos = pos;
      }

      entity.updateMesh();

      const x = -Math.sin(entity.rot.destY - 0.4) * 1.5;
      const z = -Math.cos(entity.rot.destY - 0.4) * 1.5;

      const tx = -Math.sin(entity.rot.destY - 0.42) * 1.5;
      const tz = -Math.cos(entity.rot.destY - 0.42) * 1.5;

      entity.torchParticle.transform.position.elements[0] = x + entity.pos.x;
      entity.torchParticle.transform.position.elements[1] = entity.pos.y - 0.3;
      entity.torchParticle.transform.position.elements[2] = z + entity.pos.z;

      entity.torch.transform.position.elements[0] = tx + entity.pos.x;
      entity.torch.transform.position.elements[1] = entity.pos.y - 0.5;
      entity.torch.transform.position.elements[2] = tz + entity.pos.z;

      entity.torchLight.position = entity.torch.transform.position;

      entity.torch.transform.rotation.elements[1] = entity.rot.destY;
    }

    user.mesh.transform.position.elements[1] += 2;
    user.torchParticle.transform.position.elements[1] += 2;
    user.torch.transform.position.elements[1] += 2;

    // Emit update
    genWorker.emit('movement', getSendingUser());
  };

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

  const createEntity = (data) => {
    const entity = entityList[data.id] = data;
    entity.pos = convertVector(data.pos);
    entity.rot = convertVector(data.rot);

    if (data.selfUser) {
      entity.mesh = app.main.graphics.getActiveCamera();
      user = entity;
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
  };

  const update = (socket) => socket.on('update', (data) => {
    const entity = entityList[data.id];

    if (!entity) {
      createEntity(data);
      return;
    }

    if (entity.lastUpdate >= data.lastUpdate) {
      return;
    }

    entity.lastUpdate = data.lastUpdate;
    entity.pos = convertVector(data.pos);
    entity.rot = convertVector(data.rot);
    entity.onGround = data.onGround;
    entity.alpha = 0;
  });

  const kill = (socket) => socket.on('kill', (data) => {
    entityList[data.id].mesh.unregister();
    entityList[data.id].torch.unregister();
    entityList[data.id].torchParticle.unregister();
    entityList[data.id].torchLight.unregister();
    app.main.graphics.unregisterRenderable(entityList[data.id].mesh);
    entityList[data.id] = {};
  });

  const handleWorld = (socket) => socket.on('worldData', (data) => {
    world = app.worldDefs.makeWorld();
    world.read(data);
  });

  const handleConnection = (socket) => socket.on('connect', () => {
    onMessage(socket);
    onMeshData(socket);
    timeUpdate(socket);
    update(socket);
    kill(socket);
    handleWorld(socket);
    socket.emit('join', { name: `Player${Math.floor(Math.random() * 100)}` });
  });

  const startConnection = () => {
    genWorker = io.connect();
    handleConnection(genWorker);
  };

  const getUser = () => user;

  return {
    user: getUser,
    updateEntity,
    startConnection,
  };
}());
