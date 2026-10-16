import { describe, expect, it } from "vitest";

import { readInterpolatedTransform2D, type InterpolatedTransform2D } from "../../src/index.js";
import {
  defineActor,
  definePrefab,
  onRender,
  onUpdate,
  useTransform,
} from "../../src/actor/index.js";
import { entityIndex } from "../../src/internal.js";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { createRealEngine } from "./harness.js";

const HAS = 0b01;

function fresh(): InterpolatedTransform2D {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 };
}

describe("render interpolation on real wasm", () => {
  it("at 30 Hz, advance(1/60) alternates alpha and lerps x", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 30 });
    try {
      const wasm = handle.bridge.engine();
      const id = handle.engine.createEntity();
      const slot = entityIndex(id);
      wasm.add_entity_transform(slot, 0, 0, 0, 1, 1);
      const out = fresh();
      const samples: Array<{ alpha: number; x: number }> = [];
      handle.engine.hooks.hook("engine:update", () => {
        wasm.translate_entity(slot, 1, 0);
      });
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) {
          samples.push({ alpha, x: Number.NaN });
          return;
        }
        const ok = readInterpolatedTransform2D(pair, slot, alpha, out);
        samples.push({ alpha, x: ok ? out.x : Number.NaN });
      });
      await handle.advance(10, 1 / 60);
      // The first advance calls startExternal. That seeds with update_transforms
      // and two commits while local x is still 0, so both samples are 0.
      // fixedDt is 1/30. advance(1/60) adds half a step.
      // Even frames do not step and render at alpha 0.5.
      // Odd frames run one step and render at alpha 0.
      // The step commits after update_transforms and before engine:update.
      // translate(+1) stays dirty until the next step publishes it.
      // Alpha 0 copies previous. Alpha 0.5 is (previous + current) / 2.
      // 0: no step, lerp(0, 0) = 0
      // 1: step publishes 0, alpha 0 copies 0, local becomes 1
      // 2: no step, lerp(0, 0) = 0
      // 3: step publishes 1, alpha 0 copies 0, local becomes 2
      // 4: lerp(0, 1) = 0.5
      // 5: step publishes 2, alpha 0 copies 1
      // 6: lerp(1, 2) = 1.5
      // 7: step publishes 3, alpha 0 copies 2
      // 8: lerp(2, 3) = 2.5
      // 9: step publishes 4, alpha 0 copies 3
      expect(samples.map((row) => row.alpha)).toEqual([0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0]);
      const expected = [0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3];
      expect(samples).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i += 1) {
        expect(samples[i]!.x).toBeCloseTo(expected[i]!, 5);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("at 60 Hz, advance(1/120) alternates alpha and lerps x", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const wasm = handle.bridge.engine();
      const id = handle.engine.createEntity();
      const slot = entityIndex(id);
      wasm.add_entity_transform(slot, 0, 0, 0, 1, 1);
      const out = fresh();
      const samples: Array<{ alpha: number; x: number }> = [];
      handle.engine.hooks.hook("engine:update", () => {
        wasm.translate_entity(slot, 1, 0);
      });
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) {
          samples.push({ alpha, x: Number.NaN });
          return;
        }
        const ok = readInterpolatedTransform2D(pair, slot, alpha, out);
        samples.push({ alpha, x: ok ? out.x : Number.NaN });
      });
      await handle.advance(10, 1 / 120);
      // fixedDt is 1/60. advance(1/120) also adds half a step, so the step
      // pattern matches a 30 Hz engine fed 1/60. The translate is still once
      // per step, and the commit is still before that translate.
      // Seed pair is (0, 0). Alpha 0 copies previous. Alpha 0.5 lerps.
      // 0: acc 1/120, no step, alpha 0.5, lerp(0, 0) = 0
      // 1: acc 1/60, step publishes 0, alpha 0 copies 0, local becomes 1
      // 2: acc 1/120, no step, lerp(0, 0) = 0
      // 3: step publishes 1, alpha 0 copies 0, local becomes 2
      // 4: lerp(0, 1) = 0.5
      // 5: step publishes 2, alpha 0 copies 1
      // 6: lerp(1, 2) = 1.5
      // 7: step publishes 3, alpha 0 copies 2
      // 8: lerp(2, 3) = 2.5
      // 9: step publishes 4, alpha 0 copies 3
      expect(samples.map((row) => row.alpha)).toEqual([0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0.5, 0]);
      const expected = [0, 0, 0, 0, 0.5, 1, 1.5, 2, 2.5, 3];
      expect(samples).toHaveLength(expected.length);
      for (let i = 0; i < expected.length; i += 1) {
        expect(samples[i]!.x).toBeCloseTo(expected[i]!, 5);
      }
    } finally {
      await handle.dispose();
    }
  });

  it("teleport snaps the next renders to the new position at alpha 0 and 0.5", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 30 });
    try {
      const Actor = defineActor("interp-teleport", definePrefab([]), () => {
        const transform = useTransform();
        return { transform };
      });
      await handle.engine.use(Actor._plugin);
      const id = Actor._plugin.spawn();
      const transform = Actor._instances.get(id)?.api?.transform;
      if (transform === undefined) throw new Error("actor did not return a transform");
      const slot = entityIndex(id);
      const out = fresh();
      const seen: Array<{ alpha: number; x: number; previous: number }> = [];
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) return;
        readInterpolatedTransform2D(pair, slot, alpha, out);
        seen.push({
          alpha,
          x: out.x,
          previous: pair.previous[slot * 8] ?? 0,
        });
      });
      await handle.advance(1, 1 / 30);
      transform.teleport(100, 0);
      await handle.advance(1, 1 / 30);
      await handle.advance(1, 1 / 60);
      const snapped = seen.filter((row) => row.previous === 0 && row.x === 100);
      expect(snapped.map((row) => row.alpha)).toEqual([0, 0.5]);
    } finally {
      await handle.dispose();
    }
  });

  it("a transform spawned during render is absent until the next commit, then snaps", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    try {
      const wasm = handle.bridge.engine();
      const out = fresh();
      let slot = -1;
      let duringSpawn: boolean | null = null;
      const afterCommit: Array<{ ok: boolean; x: number; flags: number }> = [];
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) return;
        if (slot < 0) {
          const id = handle.engine.createEntity();
          slot = entityIndex(id);
          wasm.add_entity_transform(slot, 4, 0, 0, 1, 1);
          duringSpawn = readInterpolatedTransform2D(pair, slot, alpha, out);
          return;
        }
        if (afterCommit.length === 0) {
          const ok = readInterpolatedTransform2D(pair, slot, alpha, out);
          afterCommit.push({
            ok,
            x: out.x,
            flags: pair.currentFlags[slot * 8 + 5] ?? 0,
          });
        }
      });
      await handle.advance(1, 1 / 60);
      await handle.advance(1, 1 / 60);
      const snapped = afterCommit[0];
      expect(duringSpawn).toBe(false);
      expect(snapped?.ok).toBe(true);
      expect(snapped?.x).toBe(4);
      expect((snapped?.flags ?? 0) & HAS).toBe(HAS);
    } finally {
      await handle.dispose();
    }
  });

  it("a destroyed TS entity stays packed after destroyEntity", async () => {
    // createEntity() writes no wasm record. destroyEntity does not remove the
    // TransformNode. The next commit still packs the slot, so the helper stays
    // true. #220 removes that node. This assertion flips when that lands.
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 30 });
    try {
      const wasm = handle.bridge.engine();
      const id = handle.engine.createEntity();
      const slot = entityIndex(id);
      wasm.add_entity_transform(slot, 8, 0, 0, 1, 1);
      const out = fresh();
      const afterDestroy: Array<{ ok: boolean; x: number }> = [];
      let renders = 0;
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        renders += 1;
        if (renders < 2) return;
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) return;
        const ok = readInterpolatedTransform2D(pair, slot, alpha, out);
        afterDestroy.push({ ok, x: ok ? out.x : Number.NaN });
      });
      await handle.advance(1, 1 / 30);
      handle.engine.destroyEntity(id);
      await handle.advance(1, 1 / 30);
      expect(afterDestroy).toEqual([{ ok: true, x: 8 }]);
    } finally {
      await handle.dispose();
    }
  });

  it("physicsHz 0 keeps alpha 1, a null pair, and equal world reads", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 0 });
    try {
      const seen: Array<{ alpha: number; world: number; raw: number }> = [];
      const Actor = defineActor("interp-variable", definePrefab([]), () => {
        const transform = useTransform();
        onUpdate(() => {
          transform.translate(1, 0);
        });
        onRender((alpha) => {
          seen.push({ alpha, world: transform.world.x, raw: transform.worldRaw.x });
        });
      });
      await handle.engine.use(Actor._plugin);
      Actor._plugin.spawn();
      await handle.advance(1, 1 / 60);
      expect(handle.engine.frame.transforms2D).toBeNull();
      expect(seen).toEqual([{ alpha: 1, world: 0, raw: 0 }]);
    } finally {
      await handle.dispose();
    }
  });

  it("world and worldRaw differ inside onRender while alpha is between 0 and 1", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 30 });
    try {
      const seen: Array<{ alpha: number; world: number; raw: number }> = [];
      const Actor = defineActor("interp-world", definePrefab([]), () => {
        const transform = useTransform();
        onUpdate(() => {
          transform.translate(1, 0);
        });
        onRender((alpha) => {
          seen.push({ alpha, world: transform.world.x, raw: transform.worldRaw.x });
        });
      });
      await handle.engine.use(Actor._plugin);
      Actor._plugin.spawn();
      await handle.advance(10, 1 / 60);
      const mid = seen.filter((row) => row.alpha > 0 && row.alpha < 1 && row.world !== row.raw);
      expect(mid.length).toBeGreaterThan(0);
      expect(mid[0]!.world).toBeCloseTo((mid[0]!.raw + (mid[0]!.raw - 1)) / 2, 5);
    } finally {
      await handle.dispose();
    }
  });

  it("stop disposes the history views", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 32, physicsHz: 60 });
    const engine = handle.engine;
    try {
      await engine.startExternal();
      const pair = engine.frame.transforms2D;
      expect(pair).not.toBeNull();
      await handle.dispose();
      expect(engine.frame.transforms2D).toBeNull();
      let caught: unknown;
      try {
        if (pair !== null) pair.current[0] = 0;
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toMatchObject({ code: CoreErrorCodes.MEMORY_VIEW_INVALID });
    } finally {
      await handle.dispose();
    }
  });
});
