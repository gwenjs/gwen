/**
 * @file `useTransform3D()` — local 3D pose for the current actor.
 *
 * `transform3d_add` keeps a node that is already there
 * (`crates/gwen-core/src/bindings.rs:1154-1156`). A physics body root therefore survives.
 * `world` during `engine:render` at `physicsHz > 0` is the reader's interpolated pose.
 * Otherwise it is one `transform3d_read_world` into a per-engine 40-byte scratch.
 * That scratch is allocated on the first raw read and freed from `engine.disposables`.
 */

import type { TransformSample3D } from "@gwenjs/schema";
import { createDisposable } from "../../disposable";
import type { GwenEngine } from "../../engine/engine-types";
import type { MemoryView } from "../../engine/engine-memory";
import { getWasmBridge, type WasmBridge } from "../../engine/wasm-bridge";
import { entityIndex } from "../../engine/engine-api";
import { TransformReader3DImpl } from "../../engine/transform-reader-3d";
import { _getActorEngine, _getActorEntityId } from "./define-actor";

const SCRATCH_BYTES = 40;
const SCRATCH_FLOATS = 10;

/** Returned when the slot has no 3D node. One frozen object for the process. */
const IDENTITY: TransformSample3D = frozenIdentity();

function frozenIdentity(): TransformSample3D {
  const sample: TransformSample3D = {
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
  Object.freeze(sample);
  return sample;
}

interface RawScratch {
  read(slot: number): TransformSample3D | undefined;
}

const scratches = new WeakMap<GwenEngine, RawScratch>();

function writeSample(sample: TransformSample3D, floats: Float32Array): void {
  sample.x = floats[0] ?? 0;
  sample.y = floats[1] ?? 0;
  sample.z = floats[2] ?? 0;
  sample.qx = floats[3] ?? 0;
  sample.qy = floats[4] ?? 0;
  sample.qz = floats[5] ?? 0;
  sample.qw = floats[6] ?? 0;
  sample.scaleX = floats[7] ?? 0;
  sample.scaleY = floats[8] ?? 0;
  sample.scaleZ = floats[9] ?? 0;
}

/**
 * One 40-byte buffer for this engine.
 * `DisposableRegistry.disposeAll` walks the stack last-in first-out
 * (`packages/core/src/disposable.ts:111`). `engine:memory` is registered while the engine
 * is built (`packages/core/src/engine/engine-collaborators.ts:205`), and this entry is
 * added later, so it runs first: `view.dispose()` then `freeSharedBuffer`.
 * `GwenEngine` stop then runs `disposables.disposeAll` (`packages/core/src/engine/gwen-engine.ts:285`)
 * and, after that, an owned `bridge.dispose` (`packages/core/src/engine/gwen-engine.ts:288`).
 * A caller that owns the bridge disposes it after `stop()` returns, which is still after
 * this free.
 */
function openScratch(engine: GwenEngine, bridge: WasmBridge): RawScratch {
  const ptr = bridge.allocSharedBuffer(SCRATCH_BYTES);
  let view: MemoryView<"f32">;
  try {
    view = engine.memory.view({
      name: "core:transform3d-world",
      type: "f32",
      ptr: () => ptr,
      length: () => SCRATCH_FLOATS,
    });
  } catch (error: unknown) {
    bridge.freeSharedBuffer(ptr, SCRATCH_BYTES);
    throw error;
  }
  const sample: TransformSample3D = {
    x: 0,
    y: 0,
    z: 0,
    qx: 0,
    qy: 0,
    qz: 0,
    qw: 1,
    scaleX: 1,
    scaleY: 1,
    scaleZ: 1,
  };
  engine.disposables.add(
    "transform3d:world-scratch",
    createDisposable(() => {
      view.dispose();
      bridge.freeSharedBuffer(ptr, SCRATCH_BYTES);
      scratches.delete(engine);
    }),
  );
  return {
    read(slot: number): TransformSample3D | undefined {
      if (!bridge.engine().transform3d_read_world(slot, ptr)) return undefined;
      writeSample(sample, view.array);
      return sample;
    },
  };
}

function rawPose(
  engine: GwenEngine,
  bridge: WasmBridge,
  slot: number,
): TransformSample3D | undefined {
  let scratch = scratches.get(engine);
  if (scratch === undefined) {
    scratch = openScratch(engine, bridge);
    scratches.set(engine, scratch);
  }
  return scratch.read(slot);
}

/**
 * Local 3D pose of the actor being spawned.
 *
 * Must be called synchronously inside a `defineActor()` factory.
 * One object is shared by every `useTransform3D()` handle of the engine. The next `world`
 * read of any actor overwrites it. Copy the fields you keep.
 *
 * @throws {GwenContextError} `CORE:OUTSIDE_ACTOR_CONTEXT` outside an actor spawn.
 */
export function useTransform3D(): Transform3DHandle {
  const entityId = _getActorEntityId("useTransform3D");
  const engine = _getActorEngine("useTransform3D");
  const idx = entityIndex(entityId);
  const bridge = getWasmBridge("useTransform3D");
  const wasm = bridge.engine();
  wasm.transform3d_add(idx, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1);

  const reader = engine.tryInject("transform:3d");
  const rendered = reader instanceof TransformReader3DImpl ? reader : undefined;
  rendered?.wantHistory();

  return {
    setPosition(x, y, z) {
      wasm.transform3d_set_position(idx, x, y, z);
    },
    setRotation(qx, qy, qz, qw) {
      wasm.transform3d_set_rotation(idx, qx, qy, qz, qw);
    },
    setScale(sx, sy, sz) {
      wasm.transform3d_set_scale(idx, sx, sy, sz);
    },
    teleport(x, y, z) {
      wasm.transform3d_set_position(idx, x, y, z);
      wasm.transform3d_mark_teleport(idx);
    },
    get world() {
      return rendered?.renderedPose(idx) ?? rawPose(engine, bridge, idx) ?? IDENTITY;
    },
  };
}

/** Handle returned by `useTransform3D()`. */
export interface Transform3DHandle {
  /** Set the local position. */
  setPosition(x: number, y: number, z: number): void;
  /** Set the local rotation. A zero or non-finite quaternion becomes the identity. */
  setRotation(qx: number, qy: number, qz: number, qw: number): void;
  /** Set the local scale. */
  setScale(sx: number, sy: number, sz: number): void;
  /** Set the local position and mark the next 3D history commit as a teleport. */
  teleport(x: number, y: number, z: number): void;
  /**
   * World pose. During `engine:render` at `physicsHz > 0`, when the history views
   * are installed and the slot has a node, this is the interpolated sample.
   * Otherwise it is the raw world pose. No node: the identity.
   * One object is shared by every `useTransform3D()` handle of the engine. The next `world`
   * read of any actor overwrites it. Copy the fields you keep.
   */
  readonly world: TransformSample3D;
}
