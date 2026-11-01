// Worker for worker-rooms.test.ts. Plain Node ESM: it loads packages/core/dist
// (no vitest aliases). Run `pnpm build:ts` before the test.

const { setupGwen } = await import(new URL("../../../dist/node.js", import.meta.url).href);
const { parentPort } = await import("node:worker_threads");

if (parentPort === null) {
  throw new Error("room-worker.mjs must run as a Worker");
}

const port = parentPort;

// FNV-1a 32-bit. The in-process reference in worker-rooms.test.ts uses the same mix.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

let opened = [];
let hang = false;
let tail = Promise.resolve();

port.on("message", (message) => {
  tail = tail
    .then(() => dispatch(message))
    .catch((error) => {
      const failure = error instanceof Error ? error : new Error(String(error));
      queueMicrotask(() => {
        throw failure;
      });
    });
});

function mixPosition(hash, position) {
  const bytes = new Uint8Array(position.buffer, position.byteOffset, position.byteLength);
  let next = hash;
  for (let index = 0; index < bytes.length; index += 1) {
    next ^= bytes[index];
    next = Math.imul(next, FNV_PRIME);
  }
  return next;
}

function hashRooms() {
  // physics_get_position(slot) returns [x, y, rot] (crates/gwen-core/src/bindings.rs:1468).
  let hash = FNV_OFFSET;
  for (const room of opened) {
    hash = mixPosition(hash, room.physics.physics_get_position(room.slot));
  }
  return hash >>> 0;
}

async function boot(wasmModule, rooms) {
  const next = [];
  for (let r = 0; r < rooms; r += 1) {
    const engine = await setupGwen({
      variant: "physics2d",
      wasmModule,
      wasmInstance: "isolated",
      maxEntities: 64,
    });
    const bridge = engine.tryInject("wasm:bridge");
    if (bridge === undefined) {
      throw new Error('tryInject("wasm:bridge") returned undefined');
    }
    const physics = bridge.getPhysicsBridge();
    physics.physics_init(0, -9.81, 64);
    const slot = bridge.createEntity().index;
    // Collider key is the raw handle from physics_add_rigid_body, not the entity slot
    // (crates/gwen-core/src/physics2d/world.rs:313-319 and :413-422).
    const x = r % 7;
    const handle = physics.physics_add_rigid_body(slot, x, 5, 1, 1, 1, 0, 0, 0.3, 0);
    physics.physics_add_ball_collider(handle, 0.5, 0, 0.5, 0, 1, 0xffff, 0xffff);
    // engine:tick receives dt (packages/schema/src/runtime-hooks.ts:98).
    engine.hooks.hook("engine:tick", (dt) => {
      if (r === 0 && hang) {
        // The host waits for this. It is sent only after the tick hook is entered.
        port.postMessage({ type: "hanging" });
        for (;;) {}
      }
      physics.physics_step(dt);
    });
    await engine.startExternal();
    next.push({ engine, physics, slot });
  }
  opened = next;
}

async function advance(steps) {
  const frames = [];
  for (const room of opened) {
    for (let step = 0; step < steps; step += 1) {
      await room.engine.advance(1 / 60);
    }
    frames.push(room.engine.frameCount);
  }
  port.postMessage({ type: "state", frames, hash: hashRooms() });
}

async function stopAll() {
  for (const room of opened) {
    await room.engine.stop();
  }
  port.postMessage({ type: "stopped" });
}

function readRooms(message) {
  if (!("rooms" in message) || typeof message.rooms !== "number") {
    throw new Error("init rooms");
  }
  return message.rooms;
}

function readModule(message) {
  if (!("module" in message) || !(message.module instanceof WebAssembly.Module)) {
    throw new Error("init module");
  }
  return message.module;
}

function readSteps(message) {
  if (!("steps" in message) || typeof message.steps !== "number") {
    throw new Error("advance steps");
  }
  return message.steps;
}

async function dispatch(message) {
  if (typeof message !== "object" || message === null || !("type" in message)) {
    throw new Error("worker message");
  }
  if (message.type === "init") {
    await boot(readModule(message), readRooms(message));
    port.postMessage({ type: "ready" });
    return;
  }
  if (message.type === "advance") {
    await advance(readSteps(message));
    return;
  }
  if (message.type === "hang") {
    const room = opened[0];
    if (room === undefined) throw new Error("room 0 missing");
    hang = true;
    void room.engine.advance(1 / 60);
    return;
  }
  if (message.type === "stop") {
    await stopAll();
    return;
  }
  throw new Error("worker message");
}
