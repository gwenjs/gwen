/**
 * `this` inside an actor lifecycle callback.
 * The engine calls the callbacks through the instance arrays (`_start`, `_destroy`, `_disable`,
 * `_release`, `_reset`, `_enable`). A `function` callback sees `this === undefined`, never the
 * internal array that holds it.
 */
import { describe, it, expect } from "vitest";
import { stubValue } from "../helpers/stub-component";
import { definePrefab, defineActor } from "../../src/actor/index";
import {
  onStart,
  onDestroy,
  onDisable,
  onEnable,
  onRelease,
  onReset,
} from "../../src/actor/runtime/define-actor";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import { useActorPool } from "../../src/actor/runtime/pool/use-actor-pool";
import { createEngine } from "../../src/node";

const Hp = stubValue("CallbackThisHp");
const Prefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

type Engine = Awaited<ReturnType<typeof createEngine>>;

/** Runs `body` on a fresh engine and always stops it. */
async function withEngine(body: (engine: Engine) => Promise<void>): Promise<void> {
  const engine = await createEngine();
  try {
    await body(engine);
  } finally {
    await engine.stop();
  }
}

describe("actor lifecycle callbacks: this", () => {
  it("onStart runs with this === undefined", async () => {
    await withEngine(async (engine) => {
      const seen: unknown[] = [];
      const Actor = defineActor(Prefab, () => {
        onStart(function (this: unknown) {
          seen.push(this);
        });
      });
      await engine.use(Actor._plugin);
      Actor._plugin.spawn();
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
    });
  });

  it("onDestroy runs with this === undefined", async () => {
    await withEngine(async (engine) => {
      const seen: unknown[] = [];
      const Actor = defineActor(Prefab, () => {
        onDestroy(function (this: unknown) {
          seen.push(this);
        });
      });
      await engine.use(Actor._plugin);
      const id = Actor._plugin.spawn();
      Actor._plugin.despawn(id);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
    });
  });
});

describe("pooled actor lifecycle callbacks: this", () => {
  /** Acquires, releases, flushes the deferred release, then acquires again. */
  async function cycle(register: () => void, engine: Engine): Promise<void> {
    const Actor = defineActor(Prefab, () => {
      register();
    });
    await engine.use(Actor._plugin);
    const definition = defineActorPool(Actor, { size: 2 });
    await engine.use(definition.plugin);
    const pool = engine.run(() => useActorPool(definition));
    const id = pool.acquire();
    pool.release(id);
    await engine.advance(0.016);
    pool.acquire();
  }

  it("onDisable runs with this === undefined", async () => {
    await withEngine(async (engine) => {
      const seen: unknown[] = [];
      await cycle(() => {
        onDisable(function (this: unknown) {
          seen.push(this);
        });
      }, engine);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
    });
  });

  it("onRelease runs with this === undefined", async () => {
    await withEngine(async (engine) => {
      const seen: unknown[] = [];
      await cycle(() => {
        onRelease(function (this: unknown) {
          seen.push(this);
        });
      }, engine);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
    });
  });

  it("onReset runs with this === undefined and still receives the props", async () => {
    await withEngine(async (engine) => {
      const seen: Array<{ self: unknown; props: { value: number } }> = [];
      const Actor = defineActor(Prefab, (_props: { value: number }) => {
        onReset(function (this: unknown, props: { value: number }) {
          seen.push({ self: this, props });
        });
      });
      await engine.use(Actor._plugin);
      const definition = defineActorPool(Actor, { size: 2 });
      await engine.use(definition.plugin);
      const pool = engine.run(() => useActorPool(definition));
      const id = pool.acquire({ value: 1 });
      pool.release(id);
      await engine.advance(0.016);
      pool.acquire({ value: 42 });
      expect(seen).toHaveLength(1);
      expect(seen[0]?.self).toBeUndefined();
      expect(seen[0]?.props).toEqual({ value: 42 });
    });
  });

  it("onEnable runs with this === undefined", async () => {
    await withEngine(async (engine) => {
      const seen: unknown[] = [];
      await cycle(() => {
        onEnable(function (this: unknown) {
          seen.push(this);
        });
      }, engine);
      expect(seen).toHaveLength(1);
      expect(seen[0]).toBeUndefined();
    });
  });
});
