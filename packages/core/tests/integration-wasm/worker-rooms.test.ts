/**
 * Multi-room physics2d on worker_threads (#268). Real WASM, no DOM.
 * The worker is plain Node ESM and loads packages/core/dist (no vitest aliases).
 * Run `pnpm build:ts` first.
 * One compiled Module is posted on init and passed as `wasmModule`
 * (packages/core/src/node.ts:108-113). A worker that ignored it and compiled
 * its own bytes would still hash the same; that path is not asserted.
 */

import { once } from "node:events";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { GwenEngine } from "../../src/engine/engine-types.js";
import type {
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
} from "../../src/engine/wasm-bridge-types.js";
import { loadGwenModule, setupGwen } from "../../src/node.js";

const NODE_DIST = fileURLToPath(new URL("../../dist/node.js", import.meta.url));
const WORKER_URL = new URL("./fixtures/room-worker.mjs", import.meta.url);
const TEST_TIMEOUT_MS = 120_000;

// Same FNV-1a 32-bit mix as fixtures/room-worker.mjs. Computed here, not copied from a worker.
const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

interface Room {
  readonly engine: GwenEngine;
  readonly physics: WasmEnginePhysics2D;
  readonly slot: number;
}

type Reply =
  | { type: "ready" }
  | { type: "state"; frames: number[]; hash: number }
  | { type: "hanging" }
  | { type: "stopped" };

interface InitRequest {
  type: "init";
  module: WebAssembly.Module;
  rooms: number;
}
interface AdvanceRequest {
  type: "advance";
  steps: number;
}
interface HangRequest {
  type: "hang";
}
interface StopRequest {
  type: "stop";
}
type WorkerRequest = InitRequest | AdvanceRequest | HangRequest | StopRequest;

const workers: Worker[] = [];
const exitCodes = new Map<Worker, number>();
const exitListeners = new Map<Worker, (code: number) => void>();

function isPhysics2d(
  value: WasmEnginePhysics2D | WasmEnginePhysics3D,
): value is WasmEnginePhysics2D {
  return "physics_add_ball_collider" in value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

function isReply(value: unknown): value is Reply {
  if (!isRecord(value)) return false;
  if (value.type === "ready" || value.type === "hanging" || value.type === "stopped") return true;
  return value.type === "state" && isNumberList(value.frames) && typeof value.hash === "number";
}

function isReplyType<T extends Reply["type"]>(
  value: Reply,
  type: T,
): value is Extract<Reply, { type: T }> {
  return value.type === type;
}

function framesOf(count: number, frame: number): number[] {
  return Array.from({ length: count }, () => frame);
}

function workerAt(list: readonly Worker[], index: number): Worker {
  const worker = list[index];
  if (worker === undefined) throw new Error(`worker ${index} missing`);
  return worker;
}

function spawn(): Worker {
  // The fixture is `.mjs`, so Node loads it as an ES module.
  // WorkerOptions has no `type` field (node_modules/.pnpm/@types+node@25.6.0/node_modules/@types/node/worker_threads.d.ts:28).
  const worker = new Worker(WORKER_URL);
  const onExit = (code: number): void => {
    exitCodes.set(worker, code);
  };
  exitListeners.set(worker, onExit);
  worker.on("exit", onExit);
  workers.push(worker);
  return worker;
}

async function releaseWorkers(): Promise<void> {
  const open = workers.splice(0);
  await Promise.allSettled(open.map((worker) => worker.terminate()));
  for (const worker of open) {
    const onExit = exitListeners.get(worker);
    if (onExit !== undefined) worker.off("exit", onExit);
    exitListeners.delete(worker);
  }
}

async function readReply<T extends Reply["type"]>(
  worker: Worker,
  type: T,
  signal: AbortSignal,
): Promise<Extract<Reply, { type: T }>> {
  for (;;) {
    const packed: unknown = await once(worker, "message", { signal });
    const payload: unknown = Array.isArray(packed) ? packed[0] : undefined;
    if (isReply(payload) && isReplyType(payload, type)) return payload;
  }
}

function workerFailure(worker: Worker, signal: AbortSignal): Promise<never> {
  const errored = once(worker, "error", { signal }).then((packed) => {
    const error: unknown = Array.isArray(packed) ? packed[0] : packed;
    throw error instanceof Error ? error : new Error("worker error");
  });
  const exited = once(worker, "exit", { signal }).then((packed) => {
    const code: unknown = Array.isArray(packed) ? packed[0] : undefined;
    throw new Error(`worker exited ${typeof code === "number" ? code : String(code)}`);
  });
  return Promise.race([errored, exited]);
}

async function ask<T extends Reply["type"]>(
  worker: Worker,
  message: WorkerRequest,
  type: T,
): Promise<Extract<Reply, { type: T }>> {
  const recorded = exitCodes.get(worker);
  if (recorded !== undefined) {
    throw new Error(`worker exited ${recorded}`);
  }
  const ac = new AbortController();
  const { signal } = ac;
  const matched = readReply(worker, type, signal);
  const failed = workerFailure(worker, signal);
  const observed = Promise.allSettled([matched, failed]);
  try {
    worker.postMessage(message);
    return await Promise.race([matched, failed]);
  } finally {
    ac.abort();
    await observed;
  }
}

function mixPosition(hash: number, position: Float32Array): number {
  const bytes = new Uint8Array(position.buffer, position.byteOffset, position.byteLength);
  let next = hash;
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte === undefined) continue;
    next ^= byte;
    next = Math.imul(next, FNV_PRIME);
  }
  return next;
}

async function openRoom(
  wasmModule: WebAssembly.Module,
  r: number,
  engines: GwenEngine[],
): Promise<Room> {
  const engine = await setupGwen({
    variant: "physics2d",
    wasmModule,
    wasmInstance: "isolated",
    maxEntities: 64,
  });
  engines.push(engine);
  const bridge = engine.tryInject("wasm:bridge");
  if (bridge === undefined) {
    throw new Error('tryInject("wasm:bridge") returned undefined');
  }
  const physics = bridge.getPhysicsBridge();
  if (!isPhysics2d(physics)) {
    throw new Error("physics bridge is not physics2d");
  }
  physics.physics_init(0, -9.81, 64);
  const slot = bridge.createEntity().index;
  // Same handle/slot split as the worker (crates/gwen-core/src/physics2d/world.rs:413-422).
  const handle = physics.physics_add_rigid_body(slot, r % 7, 5, 1, 1, 1, 0, 0, 0.3, 0);
  physics.physics_add_ball_collider(handle, 0.5, 0, 0.5, 0, 1, 0xffff, 0xffff);
  engine.hooks.hook("engine:tick", (dt) => {
    physics.physics_step(dt);
  });
  await engine.startExternal();
  return { engine, physics, slot };
}

async function refHash(roomCount: number, steps: number): Promise<number> {
  const wasmModule = await loadGwenModule("physics2d");
  const engines: GwenEngine[] = [];
  try {
    const opened: Room[] = [];
    for (let r = 0; r < roomCount; r += 1) {
      opened.push(await openRoom(wasmModule, r, engines));
    }
    for (const room of opened) {
      for (let step = 0; step < steps; step += 1) {
        await room.engine.advance(1 / 60);
      }
    }
    let hash = FNV_OFFSET;
    for (const room of opened) {
      hash = mixPosition(hash, room.physics.physics_get_position(room.slot));
    }
    return hash >>> 0;
  } finally {
    await Promise.allSettled(engines.map((engine) => engine.stop()));
  }
}

async function boot(module: WebAssembly.Module, count: number, rooms: number): Promise<Worker[]> {
  const spawned = Array.from({ length: count }, () => spawn());
  await Promise.all(spawned.map((worker) => ask(worker, { type: "init", module, rooms }, "ready")));
  return spawned;
}

beforeAll(() => {
  expect(existsSync(NODE_DIST), "run pnpm build:ts first").toBe(true);
});

afterEach(async () => {
  await releaseWorkers();
});

describe("physics2d rooms on worker_threads", () => {
  it(
    "four workers run 250 physics2d rooms each from one Module with equal state hashes",
    async () => {
      const module = await loadGwenModule("physics2d");
      const spawned = await boot(module, 4, 250);
      const states = await Promise.all(
        spawned.map((worker) => ask(worker, { type: "advance", steps: 60 }, "state")),
      );
      await Promise.all(spawned.map((worker) => ask(worker, { type: "stop" }, "stopped")));
      await releaseWorkers();
      const reference = await refHash(250, 60);
      for (const state of states) {
        expect(state.frames).toEqual(framesOf(250, 60));
      }
      expect(states.map((state) => state.hash)).toEqual([
        reference,
        reference,
        reference,
        reference,
      ]);
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "terminating one worker leaves the other workers' rooms advancing",
    async () => {
      const module = await loadGwenModule("physics2d");
      const spawned = await boot(module, 4, 250);
      const first = await Promise.all(
        spawned.map((worker) => ask(worker, { type: "advance", steps: 60 }, "state")),
      );
      for (const state of first) {
        expect(state.frames).toEqual(framesOf(250, 60));
      }
      expect(await workerAt(spawned, 0).terminate()).toBe(1);
      const second = await Promise.all(
        spawned.slice(1).map((worker) => ask(worker, { type: "advance", steps: 60 }, "state")),
      );
      await releaseWorkers();
      const reference = await refHash(250, 120);
      expect(second).toHaveLength(3);
      for (const state of second) {
        expect(state.frames).toEqual(framesOf(250, 120));
        expect(state.hash).toBe(reference);
      }
    },
    TEST_TIMEOUT_MS,
  );

  it(
    "a stuck worker is terminated and the other worker's rooms finish with correct state",
    async () => {
      const module = await loadGwenModule("physics2d");
      const spawned = await boot(module, 2, 2);
      await ask(workerAt(spawned, 0), { type: "hang" }, "hanging");
      expect(await workerAt(spawned, 0).terminate()).toBe(1);
      const state = await ask(workerAt(spawned, 1), { type: "advance", steps: 120 }, "state");
      await releaseWorkers();
      expect(state.frames).toEqual([120, 120]);
      expect(state.hash).toBe(await refHash(2, 120));
    },
    TEST_TIMEOUT_MS,
  );
});
