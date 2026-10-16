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
      const samples: Array<{ alpha: number; x: number; mid: number }> = [];
      handle.engine.hooks.hook("engine:update", () => {
        wasm.translate_entity(slot, 1, 0);
      });
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) {
          samples.push({ alpha, x: Number.NaN, mid: Number.NaN });
          return;
        }
        const base = slot * 8;
        const prev = pair.previous[base] ?? 0;
        const cur = pair.current[base] ?? 0;
        const ok = readInterpolatedTransform2D(pair, slot, alpha, out);
        samples.push({ alpha, x: ok ? out.x : Number.NaN, mid: (prev + cur) / 2 });
      });
      await handle.advance(10, 1 / 60);
      expect(samples).toHaveLength(10);
      for (let i = 0; i < samples.length; i += 1) {
        const row = samples[i]!;
        expect(row.alpha).toBe(i % 2 === 0 ? 0.5 : 0);
        if (row.alpha === 0.5) expect(row.x).toBeCloseTo(row.mid, 5);
      }
      let spaced = 0;
      for (let i = 1; i < samples.length; i += 1) {
        const delta = samples[i]!.x - samples[i - 1]!.x;
        if (spaced > 0 || Math.abs(delta - 0.5) < 1e-4) {
          expect(delta).toBeCloseTo(0.5, 5);
          spaced += 1;
        }
      }
      expect(spaced).toBeGreaterThanOrEqual(4);
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
      const samples: Array<{ alpha: number; x: number; mid: number }> = [];
      handle.engine.hooks.hook("engine:update", () => {
        wasm.translate_entity(slot, 1, 0);
      });
      handle.engine.hooks.hook("engine:render", (alpha: number) => {
        const pair = handle.engine.frame.transforms2D;
        if (pair === null) {
          samples.push({ alpha, x: Number.NaN, mid: Number.NaN });
          return;
        }
        const base = slot * 8;
        const prev = pair.previous[base] ?? 0;
        const cur = pair.current[base] ?? 0;
        const ok = readInterpolatedTransform2D(pair, slot, alpha, out);
        samples.push({ alpha, x: ok ? out.x : Number.NaN, mid: (prev + cur) / 2 });
      });
      await handle.advance(10, 1 / 120);
      expect(samples).toHaveLength(10);
      for (let i = 0; i < samples.length; i += 1) {
        const row = samples[i]!;
        expect(row.alpha).toBe(i % 2 === 0 ? 0.5 : 0);
        if (row.alpha === 0.5) expect(row.x).toBeCloseTo(row.mid, 5);
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
