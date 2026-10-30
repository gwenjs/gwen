import { GwenError } from "@gwenjs/schema";
import { createEngine } from "../../../src/engine/engine-factory";
import type { GwenEngine } from "../../../src/engine/engine-types";
import { WasmBridgeImpl } from "../../../src/internal";
import type {
  WasmEnginePhysics2D,
  WasmEnginePhysics3D,
} from "../../../src/engine/wasm-bridge-types";

/**
 * One engine the page keeps alive.
 * `createEngine` with `_bridge` does not call `init` (`packages/core/src/engine/engine-factory.ts:75`).
 * `stop()` disposes an owned bridge (`packages/core/src/engine/gwen-engine.ts:277`). The page close releases these.
 */
interface Held {
  bridge: WasmBridgeImpl;
  engine: GwenEngine;
}

interface Slot {
  getLinearMemory(): WebAssembly.Memory | null;
  countEntities(): number;
  frameCount(): number;
  advance(dt: number): Promise<void>;
}

interface HarnessState {
  isolated: Slot[];
  shared: Slot[];
}

interface Made {
  ok: boolean;
  count: number;
  code?: string;
  name?: string;
  message?: string;
}

export interface IsolatedBatch {
  failedAt?: number;
  code: string;
  name: string;
  message: string;
  counts: number[];
  distinctMemories: number;
  nullMemories: number;
}

export interface GwenHarness {
  makeIsolated(i: number): Promise<Made>;
  makeShared(): Promise<Made>;
  state(): HarnessState;
  collectIsolated(limit: number): Promise<IsolatedBatch>;
  measurePhysicsSteps(): Promise<{ early: number; late: number }>;
}

declare global {
  interface Window {
    __gwen: GwenHarness;
  }
}

const SOURCE = {
  light: {
    jsUrl: "/wasm/light/gwen_core_factory.js",
    wasmUrl: "/wasm/light/gwen_core_bg.wasm",
  },
  physics2d: {
    jsUrl: "/wasm/physics2d/gwen_core_factory.js",
    wasmUrl: "/wasm/physics2d/gwen_core_bg.wasm",
  },
} as const;

const isolated: Held[] = [];
const shared: Held[] = [];

function failed(err: unknown): Made {
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? String(Reflect.get(err, "name"))
      : "";
  const message =
    typeof err === "object" && err !== null && "message" in err
      ? String(Reflect.get(err, "message"))
      : String(err);
  if (err instanceof GwenError) return { ok: false, code: err.code, count: 0, name, message };
  return { ok: false, count: 0, name, message };
}

async function hold(
  variant: "light" | "physics2d",
  wasmInstance: "isolated" | "shared",
  bucket: Held[],
  entities: number,
  maxEntities: number,
): Promise<Made> {
  const bridge = new WasmBridgeImpl();
  const source = SOURCE[variant];
  // True only after `init` returns. `createEngine` does not release (`packages/core/src/engine/engine-factory.ts:75`).
  let acquired = false;
  try {
    await bridge.init(variant, {
      wasmInstance,
      jsUrl: source.jsUrl,
      wasmUrl: source.wasmUrl,
      maxEntities,
    });
    acquired = true;
    const engine = await createEngine({
      _bridge: bridge,
      _ownsBridge: true,
      variant,
      maxEntities,
    });
    acquired = false;
    for (let n = 0; n < entities; n += 1) engine.createEntity();
    bucket.push({ bridge, engine });
    return { ok: true, count: bridge.countEntities() };
  } catch (err: unknown) {
    // `dispose` calls `_release` (`packages/core/src/engine/wasm-bridge.ts:578`).
    if (acquired) bridge.dispose();
    return failed(err);
  }
}

function toSlot(held: Held): Slot {
  return {
    getLinearMemory: () => held.bridge.getLinearMemory(),
    countEntities: () => held.bridge.countEntities(),
    frameCount: () => held.engine.frameCount,
    advance: (dt) => held.engine.advance(dt),
  };
}

function makeIsolated(i: number): Promise<Made> {
  return hold("light", "isolated", isolated, i % 7, 16);
}

function makeShared(): Promise<Made> {
  return hold("light", "shared", shared, 0, 16);
}

function state(): HarnessState {
  return {
    isolated: isolated.map(toSlot),
    shared: shared.map(toSlot),
  };
}

function miss(i: number, made: Made): IsolatedBatch {
  return {
    failedAt: i,
    code: made.code ?? "",
    name: made.name ?? "",
    message: made.message ?? "",
    counts: [],
    distinctMemories: 0,
    nullMemories: 0,
  };
}

/** Re-reads every isolated engine after the loop. Memory identity stays in the page. */
async function collectIsolated(limit: number): Promise<IsolatedBatch> {
  for (let i = 0; i < limit; i += 1) {
    const made = await makeIsolated(i);
    if (!made.ok) return miss(i, made);
  }
  const memories = isolated.map((held) => held.bridge.getLinearMemory());
  return {
    code: "",
    name: "",
    message: "",
    counts: isolated.map((held) => held.bridge.countEntities()),
    distinctMemories: new Set(memories).size,
    nullMemories: memories.filter((memory) => memory === null).length,
  };
}

/** Even length averages the two central samples. An empty list is `NaN`. */
function medianStepMs(samples: readonly number[]): number {
  const ordered = [...samples].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  const upper = ordered[middle];
  if (upper === undefined) return Number.NaN;
  if (ordered.length % 2 === 1) return upper;
  const lower = ordered[middle - 1];
  if (lower === undefined) return Number.NaN;
  return (lower + upper) / 2;
}

function isPhysics2d(
  bridge: WasmEnginePhysics2D | WasmEnginePhysics3D,
): bridge is WasmEnginePhysics2D {
  return "physics_step" in bridge;
}

/**
 * Steps timed as one loop per engine.
 * One `physics_step` is under WebKit's `performance.now()` resolution, so the
 * sample is total/STEP_COUNT milliseconds. 64 keeps that total several milliseconds
 * once each engine has 500 dynamic bodies, and an empty loop of this length stays
 * under the timer.
 */
const STEP_COUNT = 64;

/**
 * Sixteen isolated physics2d engines, 500 entities each.
 * One dynamic body per entity: `physics_add_rigid_body`
 * (`packages/core/src/engine/wasm-bridge-types.ts:400`), body type 1
 * (`packages/physics2d/src/types/bodies.ts:10`), then `physics_add_box_collider`
 * (`packages/core/src/engine/wasm-bridge-types.ts:417`) so the step touches body memory.
 * The bridge is `getPhysicsBridge` (`packages/core/src/engine/wasm-bridge.ts:595`).
 */
async function measurePhysicsSteps(): Promise<{ early: number; late: number }> {
  const samples: number[] = [];
  for (let index = 0; index < 16; index += 1) {
    const made = await hold("physics2d", "isolated", isolated, 0, 500);
    const held = isolated[isolated.length - 1];
    if (!made.ok || held === undefined) {
      throw new Error("physics2d isolated engine did not open.");
    }
    const physics = held.bridge.getPhysicsBridge();
    if (!isPhysics2d(physics)) throw new Error("physics2d bridge has no physics_step.");
    physics.physics_init(0, -9.81, 500);
    for (let n = 0; n < 500; n += 1) {
      const id = held.bridge.createEntity();
      const handle = physics.physics_add_rigid_body(
        id.index,
        (n % 25) * 3,
        Math.floor(n / 25) * 3,
        1,
        1,
        1,
        0,
        0,
        0,
        0,
      );
      physics.physics_add_box_collider(handle, 0.4, 0.4, 0, 0.4, 0, 1, 0xffff, 0xffff);
    }
    // 4 untimed steps per engine before the clock, so shared-Module tier-up stays out of `early`.
    // Bodies never collide (3 m grid, 0.4 m half-extent, no ground), so the step is integration and broad phase only.
    for (let warm = 0; warm < 4; warm += 1) {
      physics.physics_step(1 / 60);
    }
    const started = performance.now();
    for (let step = 0; step < STEP_COUNT; step += 1) {
      physics.physics_step(1 / 60);
    }
    samples.push((performance.now() - started) / STEP_COUNT);
  }
  const early = medianStepMs(samples.slice(0, 8));
  const late = medianStepMs(samples.slice(8, 16));
  return { early, late };
}

window.__gwen = { makeIsolated, makeShared, state, collectIsolated, measurePhysicsSteps };
document.body.dataset.ready = "1";
