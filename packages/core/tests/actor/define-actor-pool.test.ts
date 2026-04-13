import { describe, it, expect } from "vitest";
import { definePrefab, defineActor } from "../../src/actor/index";
import { createEngine } from "../../src/engine/gwen-engine";
import {
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
} from "../../src/system/defines/define-system";
import { onDestroy, onEvent } from "../../src/actor/defines/define-actor";
import { onRelease, onReset } from "../../src/actor/defines/define-actor";
import { defineActorPool } from "../../src/actor/pool/define-actor-pool";
import { PoolExhaustedError } from "../../src/actor/pool/errors";
import { useActorPool } from "../../src/actor/pool/use-actor-pool";
import { defineScene } from "../../src/scene/defines/define-scene";
import { defineSceneRouter } from "../../src/router/defines/define-scene-router";
import { useSceneRouter } from "../../src/router/uses/use-scene-router";

const Hp = { __name__: "Hp" };
const TestPrefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

describe("ActorInstance pool fields", () => {
  it("instance has _isDormant=false, _release=[], _reset=[] after spawn", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    const inst = Actor._instances.get(id)!;

    expect(inst._isDormant).toBe(false);
    expect(inst._release).toEqual([]);
    expect(inst._reset).toEqual([]);
  });
});

describe("dormant frame skip", () => {
  it("onUpdate is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onUpdate(spy);
    });
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    Actor._instances.get(id)!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("onBeforeUpdate is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onBeforeUpdate(spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("onAfterUpdate is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onAfterUpdate(spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("onRender is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onRender(spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("callbacks resume when _isDormant is set back to false", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onUpdate(spy);
    });
    await engine.use(Actor._plugin);

    const inst = Actor._instances.get(Actor._plugin.spawn!())!;
    inst._isDormant = true;

    await engine.start();
    await engine.advance(16);
    expect(spy).not.toHaveBeenCalled();

    inst._isDormant = false;
    await engine.advance(16);
    await engine.stop();

    expect(spy).toHaveBeenCalledOnce();
  });

  it("non-dormant instances still receive callbacks", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onUpdate(spy);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn!();

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).toHaveBeenCalled();
  });
});

describe("onEvent dormant guard", () => {
  it("event handler is NOT called when actor is dormant", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onEvent("engine:tick", spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;
    engine.hooks.callHook("engine:tick", 16);

    expect(spy).not.toHaveBeenCalled();
  });

  it("event handler IS called when actor is not dormant", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onEvent("engine:tick", spy);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn!();

    engine.hooks.callHook("engine:tick", 16);

    expect(spy).toHaveBeenCalledOnce();
  });

  it("event cleanup still works correctly after dormant/active cycle", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onEvent("engine:tick", spy);
    });
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    const inst = Actor._instances.get(id)!;

    // Mark dormant → event is silenced
    inst._isDormant = true;
    engine.hooks.callHook("engine:tick", 16);
    expect(spy).not.toHaveBeenCalled();

    // Mark active → event fires again
    inst._isDormant = false;
    engine.hooks.callHook("engine:tick", 16);
    expect(spy).toHaveBeenCalledOnce();

    // Despawn → handler removed, no more calls
    Actor._plugin.despawn!(id);
    engine.hooks.callHook("engine:tick", 16);
    expect(spy).toHaveBeenCalledOnce(); // still once
  });
});

describe("onRelease composable", () => {
  it("registers a callback on instance._release", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onRelease(spy);
    });
    await engine.use(Actor._plugin);

    const inst = Actor._instances.get(Actor._plugin.spawn!())!;

    expect(inst._release).toHaveLength(1);
    inst._release[0]!();
    expect(spy).toHaveBeenCalledOnce();
  });

  it("multiple onRelease calls register multiple callbacks", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {
      onRelease(vi.fn());
      onRelease(vi.fn());
      onRelease(vi.fn());
    });
    await engine.use(Actor._plugin);

    const inst = Actor._instances.get(Actor._plugin.spawn!())!;
    expect(inst._release).toHaveLength(3);
  });

  it("throws when called outside a defineActor factory", () => {
    expect(() => onRelease(() => {})).toThrow("[GWEN]");
  });
});

describe("onReset composable", () => {
  it("registers a callback on instance._reset", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onReset(spy);
    });
    await engine.use(Actor._plugin);

    const inst = Actor._instances.get(Actor._plugin.spawn!())!;
    expect(inst._reset).toHaveLength(1);

    inst._reset[0]!({ value: 42 });
    expect(spy).toHaveBeenCalledWith({ value: 42 });
  });

  it("throws when called outside a defineActor factory", () => {
    expect(() => onReset(() => {})).toThrow("[GWEN]");
  });
});

// ─── helpers ─────────────────────────────────────────────────────────────────

async function makePool(size: number, opts?: Partial<Parameters<typeof defineActorPool>[1]>) {
  const engine = await createEngine();
  const Actor = defineActor(TestPrefab, () => {});
  await engine.use(Actor._plugin);
  const pool = defineActorPool(Actor, { size, ...opts });
  await engine.use(pool._plugin);
  return { engine, Actor, pool };
}

async function flush(engine: Awaited<ReturnType<typeof createEngine>>) {
  await engine.advance(16);
}

// ─── acquire ─────────────────────────────────────────────────────────────────

describe("defineActorPool — acquire", () => {
  it("returns an EntityId", async () => {
    const { pool } = await makePool(5);
    expect(typeof pool.acquire()).toBe("bigint");
  });

  it("increments stats.active", async () => {
    const { pool } = await makePool(5);
    pool.acquire();
    pool.acquire();
    expect(pool.stats().active).toBe(2);
    expect(pool.stats().available).toBe(0);
  });

  it("lazy-allocates a new entity when pool is empty", async () => {
    const { Actor, pool } = await makePool(5);
    expect(Actor._instances.size).toBe(0);
    pool.acquire();
    expect(Actor._instances.size).toBe(1);
  });

  it("reuses a dormant slot (same EntityId)", async () => {
    const { engine, pool } = await makePool(5);
    const id1 = pool.acquire();
    pool.release(id1);
    await flush(engine);

    const id2 = pool.acquire();
    expect(id2).toBe(id1);
  });

  it("does NOT call onReset on first acquire", async () => {
    const engine = await createEngine();
    const resetSpy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onReset(resetSpy);
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    await engine.use(pool._plugin);

    pool.acquire();
    expect(resetSpy).not.toHaveBeenCalled();
  });

  it("calls onReset with props on reuse", async () => {
    const engine = await createEngine();
    const resetSpy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onReset(resetSpy);
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    await engine.use(pool._plugin);

    const id = pool.acquire();
    pool.release(id);
    await flush(engine);

    pool.acquire({ value: 77 } as unknown as void);
    expect(resetSpy).toHaveBeenCalledWith({ value: 77 });
  });

  it("resets prefab defaults on slot reuse", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    await engine.use(pool._plugin);

    const id = pool.acquire();
    // Mutate the component value
    (Hp as unknown as Record<string, unknown[]>).value =
      (Hp as unknown as Record<string, unknown[]>).value ?? [];
    // Simulate mutation (engine.addComponent re-applies defaults on reuse)
    pool.release(id);
    await flush(engine);

    // After reacquire, hasComponent returns true (defaults were re-applied)
    pool.acquire();
    expect(
      engine.hasComponent(id, Hp as unknown as Parameters<typeof engine.hasComponent>[1]),
    ).toBe(true);
  });

  it("throws PoolExhaustedError when all slots are active", async () => {
    const { pool } = await makePool(2);
    pool.acquire();
    pool.acquire();
    expect(() => pool.acquire()).toThrow(PoolExhaustedError);
  });

  it("throws a clear error when called before engine.use(pool._plugin)", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    // NOT calling engine.use(pool._plugin)

    expect(() => pool.acquire()).toThrow("[GWEN]");
  });
});

// ─── release ─────────────────────────────────────────────────────────────────

describe("defineActorPool — release", () => {
  it("marks slot as available after frame flush", async () => {
    const { engine, pool } = await makePool(5);
    const id = pool.acquire();
    pool.release(id);

    // Not yet released (deferred)
    expect(pool.stats().active).toBe(1);

    await flush(engine);

    expect(pool.stats().active).toBe(0);
    expect(pool.stats().available).toBe(1);
  });

  it("calls onRelease callbacks after frame flush", async () => {
    const engine = await createEngine();
    const releaseSpy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onRelease(releaseSpy);
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    await engine.use(pool._plugin);

    const id = pool.acquire();
    pool.release(id);
    expect(releaseSpy).not.toHaveBeenCalled(); // deferred

    await flush(engine);
    expect(releaseSpy).toHaveBeenCalledOnce();
  });

  it("is a no-op for unknown ids", async () => {
    const { pool } = await makePool(5);
    expect(() =>
      pool.release(9999n as unknown as Parameters<typeof pool.release>[0]),
    ).not.toThrow();
  });

  it("is a no-op when the same id is released twice", async () => {
    const { engine, pool } = await makePool(5);
    const id = pool.acquire();
    pool.release(id);
    pool.release(id); // second call — should not double-count
    await flush(engine);

    expect(pool.stats().available).toBe(1);
  });
});

// ─── destroyAll ──────────────────────────────────────────────────────────────

describe("defineActorPool — destroyAll", () => {
  it("clears all active slots", async () => {
    const { pool } = await makePool(5);
    pool.acquire();
    pool.acquire();
    pool.destroyAll();

    expect(pool.stats().active).toBe(0);
    expect(pool.stats().available).toBe(0);
  });

  it("clears dormant slots too", async () => {
    const { engine, pool } = await makePool(5);
    const id = pool.acquire();
    pool.release(id);
    await flush(engine);

    expect(pool.stats().available).toBe(1);
    pool.destroyAll();
    expect(pool.stats().available).toBe(0);
  });

  it("calls onDestroy on every slot, not onRelease", async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();
    const releaseSpy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onDestroy(destroySpy);
      onRelease(releaseSpy);
    });
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    await engine.use(pool._plugin);

    pool.acquire();
    pool.acquire();
    pool.destroyAll();

    expect(destroySpy).toHaveBeenCalledTimes(2);
    expect(releaseSpy).not.toHaveBeenCalled();
  });

  it("is a no-op on an empty pool", async () => {
    const { pool } = await makePool(5);
    expect(() => pool.destroyAll()).not.toThrow();
    expect(pool.stats().active).toBe(0);
  });

  it("allows acquire() after destroyAll() — creates fresh entities", async () => {
    const { pool } = await makePool(5);
    pool.acquire();
    pool.destroyAll();

    const id = pool.acquire();
    expect(typeof id).toBe("bigint");
    expect(pool.stats().active).toBe(1);
  });
});

// ─── stats ───────────────────────────────────────────────────────────────────

describe("defineActorPool — stats", () => {
  it("tracks acquireCount across the pool lifetime", async () => {
    const { engine, pool } = await makePool(10);
    const id1 = pool.acquire();
    const id2 = pool.acquire();
    pool.release(id1);
    await flush(engine);
    pool.acquire(); // reuse
    pool.release(id2);
    await flush(engine);

    expect(pool.stats().acquireCount).toBe(3);
  });

  it("tracks peakActive correctly", async () => {
    const { engine, pool } = await makePool(10);
    pool.acquire();
    const id2 = pool.acquire();
    const id3 = pool.acquire();
    pool.release(id3);
    await flush(engine);
    pool.release(id2);
    await flush(engine);

    expect(pool.stats().peakActive).toBe(3);
    expect(pool.stats().active).toBe(1);
  });

  it("peakActive does not decrease after releases", async () => {
    const { engine, pool } = await makePool(10);
    const ids = [pool.acquire(), pool.acquire(), pool.acquire()];
    for (const id of ids) {
      pool.release(id);
    }
    await flush(engine);

    expect(pool.stats().peakActive).toBe(3);
  });

  it("stats returns zeros after destroyAll except peakActive", async () => {
    const { pool } = await makePool(5);
    pool.acquire();
    pool.acquire();
    pool.destroyAll();

    const s = pool.stats();
    expect(s.active).toBe(0);
    expect(s.available).toBe(0);
    expect(s.peakActive).toBe(2); // preserved
  });
});

// ─── hooks ───────────────────────────────────────────────────────────────────

describe("defineActorPool — hooks", () => {
  it("pool:acquire fires on acquire()", async () => {
    const { pool } = await makePool(5);
    const spy = vi.fn();
    pool.hooks.hook("pool:acquire", spy);

    const id = pool.acquire();
    expect(spy).toHaveBeenCalledWith({ id, props: undefined });
  });

  it("pool:release fires after frame flush", async () => {
    const { engine, pool } = await makePool(5);
    const spy = vi.fn();
    pool.hooks.hook("pool:release", spy);

    const id = pool.acquire();
    pool.release(id);
    expect(spy).not.toHaveBeenCalled();

    await flush(engine);
    expect(spy).toHaveBeenCalledWith({ id });
  });

  it("pool:exhausted fires before throw", async () => {
    const { pool } = await makePool(1);
    const spy = vi.fn();
    pool.hooks.hook("pool:exhausted", spy);

    pool.acquire();
    expect(() => pool.acquire()).toThrow(PoolExhaustedError);
    expect(spy).toHaveBeenCalledWith({ size: 1 });
  });

  it("pool:warn fires when warnThreshold is crossed", async () => {
    const { pool } = await makePool(10, { warnThreshold: 0.5 });
    const spy = vi.fn();
    pool.hooks.hook("pool:warn", spy);

    pool.acquire();
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(spy).not.toHaveBeenCalled();

    pool.acquire(); // 50% — crosses threshold
    expect(spy).toHaveBeenCalledOnce();
  });

  it("pool:critical fires when criticalThreshold is crossed", async () => {
    const { pool } = await makePool(10, { criticalThreshold: 0.9 });
    const spyWarn = vi.fn();
    const spyCrit = vi.fn();
    pool.hooks.hook("pool:warn", spyWarn);
    pool.hooks.hook("pool:critical", spyCrit);

    for (let i = 0; i < 9; i++) pool.acquire();
    expect(spyCrit).toHaveBeenCalledOnce();
    // warn fires at warnThreshold (0.8) but NOT at criticalThreshold (0.9) — only spyCrit should fire at 0.9
    for (const [payload] of spyWarn.mock.calls) {
      expect((payload as { ratio: number }).ratio).toBeLessThan(0.9);
    }
  });
});

// ─── scope ───────────────────────────────────────────────────────────────────

describe("defineActorPool — scope", () => {
  it("scope: 'global' calls destroyAll on engine:stop", async () => {
    const { engine, pool } = await makePool(5, { scope: "global" });
    pool.acquire();
    pool.acquire();

    await engine.start();
    await engine.stop();

    expect(pool.stats().active).toBe(0);
    expect(pool.stats().available).toBe(0);
  });

  it("scope: CustomScope calls onMount on plugin setup", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);

    const mountSpy = vi.fn();
    const pool = defineActorPool(Actor, {
      size: 5,
      scope: { onMount: mountSpy, onUnmount: vi.fn() },
    });
    await engine.use(pool._plugin);

    expect(mountSpy).toHaveBeenCalledOnce();
  });

  it("scope: CustomScope calls onUnmount on engine:stop", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);

    const unmountSpy = vi.fn();
    const pool = defineActorPool(Actor, {
      size: 5,
      scope: { onMount: vi.fn(), onUnmount: unmountSpy },
    });
    await engine.use(pool._plugin);

    await engine.start();
    await engine.stop();

    expect(unmountSpy).toHaveBeenCalledOnce();
  });
});

describe("useActorPool — scene integration", () => {
  it("calls destroyAll() automatically on scene exit", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);
    const pool = defineActorPool(Actor, { size: 5 });
    await engine.use(pool._plugin);

    const destroySpy = vi.spyOn(pool, "destroyAll");

    const SceneA = defineScene("a", () => {
      useActorPool(pool);
    });
    const SceneB = defineScene("b", () => {});

    const Router = defineSceneRouter({
      initial: "a",
      routes: {
        a: { scene: SceneA, on: { GO: "b" } },
        b: { scene: SceneB, on: {} },
      },
    });

    await engine.run(async () => {
      const nav = useSceneRouter(Router);
      await nav.send("GO");
    });

    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it("throws when called outside a defineScene factory", () => {
    const pool = defineActorPool(
      defineActor(TestPrefab, () => {}),
      { size: 5 },
    );
    expect(() => useActorPool(pool)).toThrow("[GWEN]");
  });
});
