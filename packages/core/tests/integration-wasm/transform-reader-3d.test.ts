/**
 * The `transform:3d` reader on real wasm: the engine provides it, refs read the render pose
 * (interpolated inside `engine:render`, latest outside), and misuse throws
 * `CORE:TRANSFORM_REF_INVALID`.
 */
import { describe, expect, it } from "vitest";

import type { EntityId } from "../../src/index.js";
import type { TransformReader3D, TransformSample3D } from "@gwenjs/schema";
import * as actor from "../../src/actor/index.js";
import { onRender, onUpdate } from "../../src/system/index.js";
import { entityIndex } from "../../src/internal.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import type { Physics3DAPI } from "../../../physics3d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics3d: Physics3DAPI;
  }
}

const DOCS = "https://gwenjs.github.io/gwen/api/errors#core-transform-ref-invalid";

function sample(): TransformSample3D {
  return {
    x: -1,
    y: -1,
    z: -1,
    qx: -1,
    qy: -1,
    qz: -1,
    qw: -1,
    scaleX: -1,
    scaleY: -1,
    scaleZ: -1,
  };
}

/** The reader of `engine`. The presence assertion is the first thing a missing reader fails. */
function readerOf(engine: RealEngineHandle["engine"]): TransformReader3D {
  const reader = engine.tryInject("transform:3d");
  expect(reader).toBeDefined();
  if (reader === undefined) throw new Error("the engine does not provide transform:3d");
  return reader;
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** `[GWEN] what`, the `Fix:` line in a dev build only, then `See <docs> (<code>)`. */
function messageOf(what: string, fix: string): string {
  const fixLine = __GWEN_DEV__ ? `\nFix: ${fix}` : "";
  return `[GWEN] ${what}${fixLine}\nSee ${DOCS} (CORE:TRANSFORM_REF_INVALID)`;
}

interface Transform3DHandle {
  setPosition(x: number, y: number, z: number): void;
  setRotation(qx: number, qy: number, qz: number, qw: number): void;
  setScale(sx: number, sy: number, sz: number): void;
  teleport(x: number, y: number, z: number): void;
  readonly world: TransformSample3D;
}

/** `useTransform3D` from the actor entry. A missing export throws, it does not crash the import. */
function useTransform3D(): Transform3DHandle {
  const fn: unknown = Reflect.get(actor, "useTransform3D");
  if (typeof fn !== "function") throw new TypeError("useTransform3D is not a function");
  const handle: unknown = Reflect.apply(fn, undefined, []);
  if (!isTransform3DHandle(handle)) throw new Error("useTransform3D did not return a handle");
  return handle;
}

function isTransform3DHandle(value: unknown): value is Transform3DHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    "setPosition" in value &&
    "setScale" in value &&
    "teleport" in value &&
    "world" in value
  );
}

/** A live entity with a 3D node at `x`. */
function spawnAt(handle: RealEngineHandle, x: number): EntityId {
  const id = handle.engine.createEntity();
  handle.bridge.engine().transform3d_add(entityIndex(id), x, 0, 0, 0, 0, 0, 1, 1, 1, 1);
  return id;
}

/** Moves the entity by +1 on x every `engine:update`. */
function moveEachUpdate(handle: RealEngineHandle, id: EntityId): void {
  const slot = entityIndex(id);
  let x = 0;
  handle.engine.hooks.hook("engine:update", () => {
    x += 1;
    handle.bridge.engine().transform3d_set_position(slot, x, 0, 0);
  });
}

/** Every `engine:render`, the `x` read for `ref` (NaN when `read` is false). */
function recordRenderX(
  handle: RealEngineHandle,
  reader: TransformReader3D,
  ref: ReturnType<TransformReader3D["track"]>,
): number[] {
  const xs: number[] = [];
  const out = sample();
  handle.engine.hooks.hook("engine:render", () => {
    xs.push(reader.read(ref, out) ? out.x : Number.NaN);
  });
  return xs;
}

/** Unit quaternion for a rotation of `degrees` about Z. */
function quatZ(degrees: number): readonly [number, number, number, number] {
  const half = (degrees * Math.PI) / 360;
  return [0, 0, Math.sin(half), Math.cos(half)];
}

/** World pose written by `transform3d_read_world`, or `undefined` when the slot has no node. */
function readWorld(
  handle: RealEngineHandle,
  slot: number,
  ptr: number,
): TransformSample3D | undefined {
  const memory = handle.bridge.getLinearMemory();
  if (memory === null) return undefined;
  if (!handle.bridge.engine().transform3d_read_world(slot, ptr)) return undefined;
  const view = new Float32Array(memory.buffer, ptr, 10);
  return {
    x: view[0] ?? Number.NaN,
    y: view[1] ?? Number.NaN,
    z: view[2] ?? Number.NaN,
    qx: view[3] ?? Number.NaN,
    qy: view[4] ?? Number.NaN,
    qz: view[5] ?? Number.NaN,
    qw: view[6] ?? Number.NaN,
    scaleX: view[7] ?? Number.NaN,
    scaleY: view[8] ?? Number.NaN,
    scaleZ: view[9] ?? Number.NaN,
  };
}

describe("transform:3d reader on real wasm", () => {
  it("every engine provides transform:3d", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const reader = readerOf(handle.engine);
      expect(typeof reader.track).toBe("function");
      expect(typeof reader.release).toBe("function");
      expect(typeof reader.read).toBe("function");
    } finally {
      await handle.dispose();
    }
  });

  it("an actor moved with useTransform3D is read interpolated at physicsHz 60 and advance(1/120)", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      const Mover = actor.defineActor("reader3d-move", actor.definePrefab([]), () => {
        const transform = useTransform3D();
        let x = 0;
        onUpdate(() => {
          x += 1;
          transform.setPosition(x, 0, 0);
        });
      });
      await handle.engine.use(Mover._plugin);
      const id = Mover._plugin.spawn();
      const ref = reader.track(id);
      const xs = recordRenderX(handle, reader, ref);
      await handle.advance(10, 1 / 120);
      const expected = [0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3];
      expect(xs).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i += 1) {
        expect(xs[i]).toBeCloseTo(expected[i] ?? Number.NaN, 5);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("useTransform3D world is interpolated in onRender and raw in onUpdate", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      readerOf(handle.engine);
      const renderX: number[] = [];
      const updateX: number[] = [];
      const Mover = actor.defineActor("reader3d-world", actor.definePrefab([]), () => {
        const transform = useTransform3D();
        let x = 0;
        onUpdate(() => {
          x += 1;
          transform.setPosition(x, 0, 0);
          updateX.push(transform.world.x);
        });
        onRender(() => {
          renderX.push(transform.world.x);
        });
      });
      await handle.engine.use(Mover._plugin);
      Mover._plugin.spawn();
      await handle.advance(10, 1 / 120);
      const expected = [0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3];
      expect(renderX).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i += 1) {
        expect(renderX[i]).toBeCloseTo(expected[i] ?? Number.NaN, 5);
      }
      expect(updateX).toEqual([1, 2, 3, 4, 5]);
    } finally {
      await handle.dispose();
    }
  });

  it("at physicsHz 0 read equals the raw 3D world pose inside engine:render", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 0 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      const slot = entityIndex(id);
      const ptr = handle.bridge.allocSharedBuffer(40);
      try {
        // Registered before the mover: it samples the raw world pose at the start of each
        // update, the instant the history is committed, before this frame moves the entity.
        const rawAtFrameStart: number[] = [];
        handle.engine.hooks.hook("engine:update", () => {
          const raw = readWorld(handle, slot, ptr);
          rawAtFrameStart.push(raw === undefined ? Number.NaN : raw.x);
        });
        moveEachUpdate(handle, id);
        await handle.advance(3, 1 / 60);
        const ref = reader.track(id);
        // The first commit after `track` seeds the history.
        await handle.advance(1, 1 / 60);
        const out = sample();
        const read: number[] = [];
        const raw: number[] = [];
        handle.engine.hooks.hook("engine:render", () => {
          read.push(reader.read(ref, out) ? out.x : Number.NaN);
        });
        const framesBefore = rawAtFrameStart.length;
        await handle.advance(5, 1 / 60);
        raw.push(...rawAtFrameStart.slice(framesBefore));
        expect(read).toEqual([4, 5, 6, 7, 8]);
        expect(raw).toEqual([4, 5, 6, 7, 8]);
      } finally {
        handle.bridge.freeSharedBuffer(ptr, 40);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("a falling physics3d body is read between two steps", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      await handle.engine.use(
        Physics3DPlugin({ gravity: { x: 0, y: -9.81, z: 0 }, maxEntities: 32 }),
      );
      const physics = handle.engine.inject("physics3d");
      // No transform3d_add and no useTransform3D: the body alone owns the node.
      const id = handle.engine.createEntity();
      physics.createBody(id, { kind: "dynamic", initialPosition: { x: 0, y: 100, z: 0 } });
      const ref = reader.track(id);
      const committed: number[] = [];
      handle.engine.hooks.hook("engine:update", () => {
        const y = physics.getBodyState(id)?.position.y;
        if (y !== undefined) committed.push(y);
      });
      const half: Array<{ y: number; midpoint: number }> = [];
      const renders: number[] = [];
      const out = sample();
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const ok = reader.read(ref, out);
        renders.push(ok ? out.y : Number.NaN);
        const last = committed[committed.length - 1];
        const before = committed[committed.length - 2];
        if (ok && alpha === 0.5 && last !== undefined && before !== undefined) {
          half.push({ y: out.y, midpoint: (last + before) / 2 });
        }
      });
      await handle.advance(10, 1 / 120);
      expect(half.length).toBeGreaterThan(0);
      for (const row of half) expect(row.y).toBeCloseTo(row.midpoint, 5);
      for (let i = 3; i < renders.length; i += 1) {
        expect(renders[i]).not.toBe(renders[i - 1]);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("rotation blends on the shorter arc and stays normalised", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      const id = handle.engine.createEntity();
      const slot = entityIndex(id);
      const start = quatZ(170);
      handle.bridge
        .engine()
        .transform3d_add(slot, 0, 0, 0, start[0], start[1], start[2], start[3], 1, 1, 1);
      const ref = reader.track(id);
      // advance(1/120) at 60 Hz steps on frames 1, 3, 5. The first update stores
      // -170 deg. The next step commits it. The alpha 0.5 frame after that commit
      // is sample 4: the shorter arc, not the long arc through the identity.
      let steps = 0;
      handle.engine.hooks.hook("engine:update", () => {
        steps += 1;
        if (steps !== 1) return;
        const next = quatZ(-170);
        handle.bridge.engine().transform3d_set_rotation(slot, next[0], next[1], next[2], next[3]);
      });
      const samples: Array<{ alpha: number; qz: number; qw: number; len: number }> = [];
      const out = sample();
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        if (!reader.read(ref, out)) return;
        samples.push({
          alpha,
          qz: out.qz,
          qw: out.qw,
          len: Math.hypot(out.qx, out.qy, out.qz, out.qw),
        });
      });
      await handle.advance(5, 1 / 120);
      expect(samples).toHaveLength(5);
      for (const row of samples) expect(row.len).toBeCloseTo(1, 5);
      const blend = samples[4];
      expect(blend?.alpha).toBe(0.5);
      expect(Math.abs(blend?.qz ?? Number.NaN)).toBeCloseTo(1, 5);
      expect(Math.abs(blend?.qw ?? Number.NaN)).toBeCloseTo(0, 5);
    } finally {
      await handle.dispose();
    }
  });

  it("at physicsHz 0 no 3D history buffer exists without a tracked ref", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 0 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 5);
      await handle.advance(3, 1 / 60);
      expect(handle.bridge.engine().transform3d_history_ptr(0)).toBe(0);
      const ref = reader.track(id);
      const out = sample();
      expect(reader.read(ref, out)).toBe(false);
      expect(handle.bridge.engine().transform3d_history_ptr(0)).toBe(0);
      await handle.advance(1, 1 / 60);
      expect(handle.bridge.engine().transform3d_history_ptr(0)).not.toBe(0);
      expect(reader.read(ref, out)).toBe(true);
      expect(out.x).toBe(5);
      expect(handle.bridge.engine().transform_history_ptr(0)).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("a ref tracked after the first advance reads in the next display with no fixed step", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 4);
      await handle.advance(1, 1 / 60);
      const ref = reader.track(id);
      const out = sample();
      let read = false;
      handle.engine.hooks.hook("engine:render", () => {
        read = reader.read(ref, out);
      });
      await handle.advance(1, 1 / 120);
      expect(read).toBe(true);
      expect(out.x).toBe(4);
    } finally {
      await handle.dispose();
    }
  });

  it("at physicsHz 0 useTransform3D allocates no 3D history buffer", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 0 });
    try {
      readerOf(handle.engine);
      const Still = actor.defineActor("reader3d-hz0-history", actor.definePrefab([]), () => {
        useTransform3D();
      });
      await handle.engine.use(Still._plugin);
      Still._plugin.spawn();
      await handle.advance(3, 1 / 60);
      expect(handle.bridge.engine().transform3d_history_ptr(0)).toBe(0);
    } finally {
      await handle.dispose();
    }
  });

  it("track on a destroyed entity throws dead-entity", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      handle.engine.destroyEntity(id);
      const error = caught(() => reader.track(id));
      expect(error).toMatchObject({ code: "CORE:TRANSFORM_REF_INVALID", reason: "dead-entity" });
      expect(error).toHaveProperty(
        "message",
        messageOf(
          "TransformReader3D.track() needs a live entity",
          "Track an entity that is still alive, and release the ref when the entity is destroyed.",
        ),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("a ref from another engine throws foreign-engine", async () => {
    const first = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const second = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
      try {
        const readerA = readerOf(first.engine);
        const readerB = readerOf(second.engine);
        const ref = readerA.track(spawnAt(first, 0));
        const error = caught(() => readerB.read(ref, sample()));
        expect(error).toMatchObject({
          code: "CORE:TRANSFORM_REF_INVALID",
          reason: "foreign-engine",
        });
        expect(error).toHaveProperty(
          "message",
          messageOf(
            "TransformReader3D.read() got a ref tracked on another engine",
            "Read a ref with the reader of the engine that tracked it.",
          ),
        );
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
    }
  });

  it("a ref of the 2D reader throws foreign-engine on the 3D reader", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const reader = readerOf(handle.engine);
      const reader2d = handle.engine.tryInject("transform:2d");
      expect(reader2d).toBeDefined();
      if (reader2d === undefined) throw new Error("the engine does not provide transform:2d");
      const ref2d = reader2d.track(handle.engine.createEntity());
      const error = caught(() => Reflect.apply(reader.read, reader, [ref2d, sample()]));
      expect(error).toMatchObject({
        code: "CORE:TRANSFORM_REF_INVALID",
        reason: "foreign-engine",
      });
      expect(error).toHaveProperty(
        "message",
        messageOf(
          "TransformReader3D.read() got a ref tracked on another engine",
          "Read a ref with the reader of the engine that tracked it.",
        ),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("track after stop throws engine-stopped", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      await handle.dispose();
      const error = caught(() => reader.track(id));
      expect(error).toMatchObject({ code: "CORE:TRANSFORM_REF_INVALID", reason: "engine-stopped" });
      expect(error).toHaveProperty(
        "message",
        messageOf(
          "TransformReader3D.track() called after the engine stopped",
          "Track before the engine stops, or create a new engine.",
        ),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("a released ref reads false", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 5);
      const released = reader.track(id);
      const kept = reader.track(id);
      await handle.advance(2, 1 / 30);
      const out = sample();
      expect(reader.read(released, out)).toBe(true);
      expect(out.x).toBe(5);
      reader.release(released);
      reader.release(released);
      const untouched = sample();
      expect(reader.read(released, untouched)).toBe(false);
      expect(untouched).toEqual(sample());
      expect(reader.read(kept, out)).toBe(true);
      handle.engine.destroyEntity(id);
      expect(reader.read(kept, out)).toBe(false);
    } finally {
      await handle.dispose();
    }
  });

  it("teleport snaps the 3D reader at alpha 0.5", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      // Steps land on frames 1, 3, 5, 7. Teleport on step 2 is committed on step 3,
      // so renders 0..4 stay 0 and renders 5..7 snap to 100.
      let step = 0;
      const Jumper = actor.defineActor("reader3d-teleport", actor.definePrefab([]), () => {
        const transform = useTransform3D();
        onUpdate(() => {
          step += 1;
          if (step === 2) transform.teleport(100, 0, 0);
        });
      });
      await handle.engine.use(Jumper._plugin);
      const id = Jumper._plugin.spawn();
      const ref = reader.track(id);
      const xs = recordRenderX(handle, reader, ref);
      await handle.advance(8, 1 / 120);
      expect(xs.slice(0, 5)).toEqual([0, 0, 0, 0, 0]);
      expect(xs.slice(5)).toEqual([100, 100, 100]);
    } finally {
      await handle.dispose();
    }
  });

  it("reads the entity at slot maxEntities - 1", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const reader = readerOf(handle.engine);
      let last: EntityId = handle.engine.createEntity();
      for (let i = 1; i < 8; i += 1) last = handle.engine.createEntity();
      expect(entityIndex(last)).toBe(7);
      handle.bridge.engine().transform3d_add(7, 7, 0, 0, 0, 0, 0, 1, 1, 1, 1);
      const ref = reader.track(last);
      await handle.advance(2, 1 / 30);
      const out = sample();
      expect(reader.read(ref, out)).toBe(true);
      expect(out.x).toBe(7);
    } finally {
      await handle.dispose();
    }
  });

  it("two engines keep separate 3D stores and histories", async () => {
    const first = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const second = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
      try {
        const readerA = readerOf(first.engine);
        const readerB = readerOf(second.engine);
        expect(readerA).not.toBe(readerB);
        const refA = readerA.track(spawnAt(first, 1));
        const refB = readerB.track(spawnAt(second, 8));
        await Promise.all([first.advance(2, 1 / 30), second.advance(2, 1 / 30)]);
        const outA = sample();
        const outB = sample();
        expect(readerA.read(refA, outA)).toBe(true);
        expect(readerB.read(refB, outB)).toBe(true);
        expect([outA.x, outB.x]).toEqual([1, 8]);
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
    }
  });

  it("useTransform3D before a physics3d body keeps its node", async () => {
    const handle = await createRealEngine({ variant: "physics3d", maxEntities: 32, physicsHz: 0 });
    try {
      readerOf(handle.engine);
      await handle.engine.use(Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 }, maxEntities: 32 }));
      const physics = handle.engine.inject("physics3d");
      const Placed = actor.defineActor("reader3d-keep-node", actor.definePrefab([]), () => {
        const transform = useTransform3D();
        transform.setPosition(7, 7, 7);
        transform.setScale(2, 2, 2);
      });
      await handle.engine.use(Placed._plugin);
      const id = Placed._plugin.spawn();
      physics.createBody(id, { kind: "dynamic", initialPosition: { x: 1, y: 2, z: 3 } });
      const ptr = handle.bridge.allocSharedBuffer(40);
      try {
        const pose = readWorld(handle, entityIndex(id), ptr);
        expect(pose?.x).toBeCloseTo(7, 5);
        expect(pose?.y).toBeCloseTo(7, 5);
        expect(pose?.z).toBeCloseTo(7, 5);
        expect(pose?.scaleX).toBeCloseTo(2, 5);
      } finally {
        handle.bridge.freeSharedBuffer(ptr, 40);
      }
    } finally {
      await handle.dispose();
    }
  });
});
