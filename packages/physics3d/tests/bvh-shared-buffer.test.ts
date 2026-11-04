/**
 * A mesh collider of 500 triangles or more is built by the BVH worker. Its vertex and index
 * buffers are copied, then transferred. A `SharedArrayBuffer` cannot be transferred: the load
 * fails, as it always did. The worker is a stand-in whose `postMessage` runs the platform
 * `structuredClone` with the same transfer list, so the platform makes that decision.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runInNewContext } from "node:vm";
import { createEntityId } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";

import { buildLayerRegistry, normalizePhysics3DConfig } from "../src/config";
import { Physics3DErrorCodes } from "../src/errors/codes";
import { copyForTransfer, isArrayBuffer } from "../src/internal/array-buffer";
import { addColliderImpl } from "../src/plugin/collider-management";
import { createPluginContext, type PluginContext } from "../src/plugin/plugin-context";
import type { Physics3DBridgeRuntime, Physics3DWasmBridge } from "../src/plugin/bridge";
import type { Physics3DBodyHandle } from "../src/types";

const SLOT = 5;
const ENTITY = createEntityId(SLOT, 0);
const TRIANGLES = 500;

interface JobMessage {
  id: number;
  vertices: Float32Array;
  indices: Uint32Array;
}

const posted: JobMessage[] = [];
const loaded: Uint8Array[] = [];

/** A worker that answers every accepted job with four bytes of BVH. */
class StandInWorker {
  onmessage: ((event: { data: unknown }) => void) | null = null;

  postMessage(message: JobMessage, transfer: ArrayBuffer[]): void {
    const received: JobMessage = structuredClone(message, { transfer });
    posted.push(received);
    queueMicrotask(() => {
      this.onmessage?.({ data: { id: received.id, bvhBytes: new Uint8Array(4), error: null } });
    });
  }
}

function makeContext(): PluginContext {
  const bridge: Physics3DWasmBridge = {
    physics3d_load_bvh_collider: (_slot, bvhBytes) => {
      loaded.push(bvhBytes);
      return true;
    },
  };
  const cfg = normalizePhysics3DConfig({});
  const ctx = createPluginContext(cfg, buildLayerRegistry(cfg.layers));
  const memory = new WebAssembly.Memory({ initial: 1 });
  const runtime: Physics3DBridgeRuntime = {
    variant: "physics3d",
    getPhysicsBridge: () => bridge,
    getLinearMemory: () => memory,
  };
  ctx.backendMode = "wasm";
  ctx.wasmBridge = bridge;
  ctx.bridgeRuntime = runtime;
  const handle: Physics3DBodyHandle = {
    bodyId: ctx.nextBodyId++,
    entityId: ENTITY,
    kind: "dynamic",
    mass: 1,
    linearDamping: 0,
    angularDamping: 0,
  };
  ctx.bodyByEntity.set(SLOT, handle);
  return ctx;
}

let originalWorker: PropertyDescriptor | undefined;

beforeEach(() => {
  posted.length = 0;
  loaded.length = 0;
  originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.defineProperty(globalThis, "Worker", {
    value: StandInWorker,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  if (originalWorker) Object.defineProperty(globalThis, "Worker", originalWorker);
  else Reflect.deleteProperty(globalThis, "Worker");
});

describe("mesh collider BVH job — buffers handed to the worker", () => {
  it("transfers a copy of ArrayBuffer-backed vertices and indices and loads the BVH", async () => {
    const ctx = makeContext();
    const vertices = new Float32Array(TRIANGLES * 9).fill(2);
    const indices = new Uint32Array(TRIANGLES * 3).fill(1);

    expect(
      addColliderImpl(ctx, ENTITY, { shape: { type: "mesh", vertices, indices }, colliderId: 1 }),
    ).toBe(true);
    await ctx._pendingBvhLoads.get(1)?.ready;

    expect(posted).toHaveLength(1);
    expect(posted[0]?.vertices.length).toBe(vertices.length);
    expect(posted[0]?.vertices[0]).toBe(2);
    expect(posted[0]?.indices[0]).toBe(1);
    // The copy was transferred, the caller's arrays are untouched.
    expect(vertices.length).toBe(TRIANGLES * 9);
    expect(loaded).toHaveLength(1);
  });

  it("rejects the load of a mesh whose vertices sit on a SharedArrayBuffer, and posts no job", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const vertices = new Float32Array(new SharedArrayBuffer(TRIANGLES * 9 * 4));
      const indices = new Uint32Array(TRIANGLES * 3);

      expect(
        addColliderImpl(ctx, ENTITY, { shape: { type: "mesh", vertices, indices }, colliderId: 2 }),
      ).toBe(true);
      const ready = ctx._pendingBvhLoads.get(2)?.ready;

      await expect(ready).rejects.toMatchObject({ code: Physics3DErrorCodes.BVH_LOAD_FAILED });
      expect(posted).toHaveLength(0);
      expect(loaded).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("rejects the load of a mesh whose indices sit on a SharedArrayBuffer, and posts no job", async () => {
    vi.useFakeTimers();
    try {
      const ctx = makeContext();
      const vertices = new Float32Array(TRIANGLES * 9);
      const indices = new Uint32Array(new SharedArrayBuffer(TRIANGLES * 3 * 4));

      expect(
        addColliderImpl(ctx, ENTITY, { shape: { type: "mesh", vertices, indices }, colliderId: 3 }),
      ).toBe(true);
      const ready = ctx._pendingBvhLoads.get(3)?.ready;

      await expect(ready).rejects.toMatchObject({ code: Physics3DErrorCodes.BVH_LOAD_FAILED });
      expect(posted).toHaveLength(0);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe("isArrayBuffer and copyForTransfer", () => {
  it("accepts an ArrayBuffer made in this realm and in another one", () => {
    expect(isArrayBuffer(new ArrayBuffer(8))).toBe(true);
    expect(isArrayBuffer(runInNewContext("new ArrayBuffer(8)"))).toBe(true);
  });

  it("rejects a SharedArrayBuffer", () => {
    expect(isArrayBuffer(new SharedArrayBuffer(8))).toBe(false);
  });

  it("copies the whole buffer, not a view of it", () => {
    const source = new Uint8Array([1, 2, 3, 4]).buffer;
    const copy = copyForTransfer(source);
    expect(copy).not.toBe(source);
    expect(Array.from(new Uint8Array(copy))).toEqual([1, 2, 3, 4]);
  });

  it("throws PHYSICS3D:BVH_LOAD_FAILED for a SharedArrayBuffer", () => {
    let caught: unknown;
    try {
      copyForTransfer(new SharedArrayBuffer(8));
    } catch (err: unknown) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).toMatchObject({ code: "PHYSICS3D:BVH_LOAD_FAILED" });
  });
});
