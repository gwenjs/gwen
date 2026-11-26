/**
 * The `transform:2d` reader on real wasm: the engine provides it, refs read the render pose
 * (interpolated inside `engine:render`, latest outside), and misuse throws
 * `CORE:TRANSFORM_REF_INVALID`.
 */
import { describe, expect, it } from "vitest";

import type { TransformReader2D, TransformSample2D } from "@gwenjs/schema";
import type { EntityId } from "../../src/index.js";
import { entityIndex } from "../../src/internal.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import type { Physics2DAPI } from "../../../physics2d/src/types";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    physics2d: Physics2DAPI;
  }
}

const DOCS = "https://gwenjs.github.io/gwen/api/errors#core-transform-ref-invalid";

function sample(): TransformSample2D {
  return { x: -1, y: -1, rotation: -1, scaleX: -1, scaleY: -1 };
}

/** The reader of `engine`. The presence assertion is the first thing a missing reader fails. */
function readerOf(engine: RealEngineHandle["engine"]): TransformReader2D {
  const reader = engine.tryInject("transform:2d");
  expect(reader).toBeDefined();
  if (reader === undefined) throw new Error("the engine does not provide transform:2d");
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

/** A live entity with a transform node at `x`. */
function spawnAt(handle: RealEngineHandle, x: number): EntityId {
  const id = handle.engine.createEntity();
  handle.bridge.engine().add_entity_transform(entityIndex(id), x, 0, 0, 1, 1);
  return id;
}

/** Moves the entity by +1 on every `engine:update`. */
function moveEachUpdate(handle: RealEngineHandle, id: EntityId): void {
  const slot = entityIndex(id);
  handle.engine.hooks.hook("engine:update", () => {
    handle.bridge.engine().translate_entity(slot, 1, 0);
  });
}

/** Every `engine:render`, the `x` read for `ref` (NaN when `read` is false). */
function recordRenderX(
  handle: RealEngineHandle,
  reader: TransformReader2D,
  ref: ReturnType<TransformReader2D["track"]>,
): number[] {
  const xs: number[] = [];
  const out = sample();
  handle.engine.hooks.hook("engine:render", () => {
    xs.push(reader.read(ref, out) ? out.x : Number.NaN);
  });
  return xs;
}

describe("transform:2d reader on real wasm", () => {
  it("every engine provides transform:2d", async () => {
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

  it("at physicsHz 60 and advance(1/120) read returns the interpolated series", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      const ref = reader.track(id);
      moveEachUpdate(handle, id);
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

  it("a falling physics2d body is read between two steps", async () => {
    const handle = await createRealEngine({ variant: "physics2d", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      await handle.engine.use(Physics2DPlugin({ gravity: { x: 0, y: -9.81 }, maxEntities: 32 }));
      const physics = handle.engine.inject("physics2d");
      // No add_entity_transform and no useTransform: the body alone owns the node.
      const id = handle.engine.createEntity();
      physics.addRigidBody(id, "dynamic", 0, 100);
      const ref = reader.track(id);
      const slot = entityIndex(id);
      const committed: number[] = [];
      handle.engine.hooks.hook("engine:update", () => {
        committed.push(handle.bridge.engine().get_entity_world_y(slot));
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

  it("at physicsHz 0 read equals the raw world pose inside engine:render", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 0 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      const slot = entityIndex(id);
      moveEachUpdate(handle, id);
      await handle.advance(3, 1 / 60);
      const ref = reader.track(id);
      // The first commit after `track` seeds the history.
      await handle.advance(1, 1 / 60);
      const out = sample();
      const pairs: Array<[number, number]> = [];
      handle.engine.hooks.hook("engine:render", () => {
        const ok = reader.read(ref, out);
        pairs.push([ok ? out.x : Number.NaN, handle.bridge.engine().get_entity_world_x(slot)]);
      });
      await handle.advance(5, 1 / 60);
      expect(pairs.map((pair) => pair[0])).toEqual([4, 5, 6, 7, 8]);
      expect(pairs.map((pair) => pair[1])).toEqual([4, 5, 6, 7, 8]);
    } finally {
      await handle.dispose();
    }
  });

  it("at physicsHz 0 history buffers appear only after the first track", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 0 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 5);
      await handle.advance(3, 1 / 60);
      expect(handle.bridge.engine().transform_history_ptr(0)).toBe(0);
      const ref = reader.track(id);
      const out = sample();
      expect(reader.read(ref, out)).toBe(false);
      expect(handle.bridge.engine().transform_history_ptr(0)).toBe(0);
      await handle.advance(1, 1 / 60);
      expect(handle.bridge.engine().transform_history_ptr(0)).not.toBe(0);
      expect(reader.read(ref, out)).toBe(true);
      expect(out.x).toBe(5);
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
          "TransformReader2D.track() needs a live entity",
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
        const ref = readerOf(first.engine).track(spawnAt(first, 0));
        const error = caught(() => readerOf(second.engine).read(ref, sample()));
        expect(error).toMatchObject({
          code: "CORE:TRANSFORM_REF_INVALID",
          reason: "foreign-engine",
        });
        expect(error).toHaveProperty(
          "message",
          messageOf(
            "TransformReader2D.read() got a ref tracked on another engine",
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

  it("release of a ref from another engine does nothing", async () => {
    const first = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const second = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
      try {
        const readerA = readerOf(first.engine);
        const readerB = readerOf(second.engine);
        const refA = readerA.track(spawnAt(first, 5));
        await first.advance(2, 1 / 30);
        readerB.release(refA);
        const out = sample();
        expect(readerA.read(refA, out)).toBe(true);
        expect(out.x).toBe(5);
      } finally {
        await second.dispose();
      }
    } finally {
      await first.dispose();
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
          "TransformReader2D.track() called after the engine stopped",
          "Track before the engine stops, or create a new engine.",
        ),
      );
    } finally {
      await handle.dispose();
    }
  });

  it("read after stop and a released ref return false", async () => {
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
      await handle.dispose();
      const afterStop = sample();
      expect(reader.read(kept, afterStop)).toBe(false);
      expect(afterStop).toEqual(sample());
    } finally {
      await handle.dispose();
    }
  });

  it("a reused slot never reads through an old ref", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8, physicsHz: 30 });
    try {
      const reader = readerOf(handle.engine);
      const old = spawnAt(handle, 3);
      const oldRef = reader.track(old);
      handle.engine.destroyEntity(old);
      const next = spawnAt(handle, 7);
      expect(entityIndex(next)).toBe(entityIndex(old));
      const nextRef = reader.track(next);
      await handle.advance(2, 1 / 30);
      const out = sample();
      expect(reader.read(oldRef, out)).toBe(false);
      expect(reader.read(nextRef, out)).toBe(true);
      expect(out.x).toBe(7);
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
      handle.bridge.engine().add_entity_transform(7, 7, 0, 0, 1, 1);
      const ref = reader.track(last);
      await handle.advance(2, 1 / 30);
      const out = sample();
      expect(reader.read(ref, out)).toBe(true);
      expect(out.x).toBe(7);
    } finally {
      await handle.dispose();
    }
  });

  it("teleport snaps the reader at alpha 0.5", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      const slot = entityIndex(id);
      const ref = reader.track(id);
      await handle.advance(1, 1 / 120);
      handle.bridge.engine().set_entity_local_position(slot, 100, 0);
      handle.bridge.engine().mark_entity_teleport(slot);
      const xs = recordRenderX(handle, reader, ref);
      await handle.advance(4, 1 / 120);
      expect(xs.slice(1)).toEqual([100, 100, 100]);
    } finally {
      await handle.dispose();
    }
  });

  it("two engines keep separate readers and poses", async () => {
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

  it("track of a non-bigint id throws CORE:INVALID_ENTITY_ID", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const reader = readerOf(handle.engine);
      const error = caught(() => Reflect.apply(reader.track, reader, [3]));
      expect(error).toMatchObject({ code: "CORE:INVALID_ENTITY_ID" });
    } finally {
      await handle.dispose();
    }
  });

  it("track of a non-bigint id on a stopped engine reports the id error first", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const reader = readerOf(handle.engine);
      await handle.dispose();
      const error = caught(() => Reflect.apply(reader.track, reader, [3]));
      expect(error).toMatchObject({ code: "CORE:INVALID_ENTITY_ID" });
      expect(error).not.toHaveProperty("reason");
    } finally {
      await handle.dispose();
    }
  });

  it("read outside engine:render at a fixed step returns the latest committed pose", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const reader = readerOf(handle.engine);
      const id = spawnAt(handle, 0);
      const ref = reader.track(id);
      moveEachUpdate(handle, id);
      // Two steps. The last display frame renders at alpha 0, the pair is (0, 1).
      await handle.advance(4, 1 / 120);
      const out = sample();
      expect(reader.read(ref, out)).toBe(true);
      expect(out.x).toBe(handle.bridge.engine().get_entity_world_x(entityIndex(id)));
      expect(out.x).toBe(1);
    } finally {
      await handle.dispose();
    }
  });
});
