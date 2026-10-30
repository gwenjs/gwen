/**
 * @file GwenScope reads and writes the kit scope slot (P-76-5).
 */

import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { defineSystem } from "@gwenjs/core/system";
import type { GwenEngineBase, IGwenLogger, IGwenScope } from "@gwenjs/schema";
import * as kit from "@gwenjs/kit";
import { GwenScope } from "../../src/context/scope.js";

const engines: { stop: () => Promise<void> }[] = [];

afterEach(async () => {
  if (typeof kit._setCurrentScope === "function") kit._setCurrentScope(null);
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function plainEngine(): GwenEngineBase {
  const logger: IGwenLogger = {
    debug() {},
    info() {},
    warn() {},
    error() {},
    child() {
      return logger;
    },
  };
  return {
    provide() {},
    inject(): unknown {
      return undefined;
    },
    tryInject(): undefined {
      return undefined;
    },
    hooks: {
      hook() {},
      removeHook() {},
    },
    logger,
    run<T>(fn: () => T): T {
      return fn();
    },
    disposables: {
      add() {},
      disposeAll() {},
      size: 0,
    },
  };
}

function foreignScope(): IGwenScope {
  return {
    meta: { type: "plugin", id: "foreign" },
    engine: plainEngine(),
    parent: null,
    paused: false,
    hookCount: 0,
    childCount: 0,
    cleanupCount: 0,
    hook() {
      return () => {};
    },
    onCleanup() {},
    run<T>(fn: () => T): T {
      return fn();
    },
    pause() {},
    resume() {},
    dispose() {},
  };
}

async function openEngine(): Promise<Awaited<ReturnType<typeof createEngine>>> {
  const engine = await createEngine({ maxEntities: 64 });
  engines.push(engine);
  return engine;
}

describe("kit scope slot", () => {
  it("getCurrentScope from kit is null outside any run", async () => {
    expect(typeof kit.getCurrentScope).toBe("function");
    const engine = await openEngine();
    expect(kit.getCurrentScope()).toBeNull();
    await engine.use(
      defineSystem("slot-null", () => {
        expect(kit.getCurrentScope()).not.toBeNull();
      })(),
    );
    expect(kit.getCurrentScope()).toBeNull();
  });

  it("getCurrentScope from kit returns the scope a system factory activates", async () => {
    expect(typeof kit.getCurrentScope).toBe("function");
    const engine = await openEngine();
    const seen: IGwenScope[] = [];
    await engine.use(
      defineSystem("slot-read", () => {
        const slot = kit.getCurrentScope();
        expect(slot).not.toBeNull();
        if (slot === null) return;
        expect(kit.useCurrentScope()).toBe(slot);
        expect(GwenScope.current()).toBe(slot);
        seen.push(slot);
      })(),
    );
    const slot = seen[0];
    expect(slot).not.toBeUndefined();
    if (slot === undefined) return;
    expect(slot.meta.type).toBe("system");
  });

  it("the outer scope comes back after a nested scope run throws", async () => {
    expect(typeof kit.getCurrentScope).toBe("function");
    const engine = await openEngine();
    const actor = defineActor("slot-boom", definePrefab([]), () => {
      throw new Error("boom");
    });
    await engine.use(actor._plugin);
    let outer: IGwenScope | null = null;
    let restored: IGwenScope | null = null;
    let caught = false;
    await engine.use(
      defineSystem("slot-outer", () => {
        outer = kit.getCurrentScope();
        const spawn = actor._plugin.spawn;
        expect(typeof spawn).toBe("function");
        if (typeof spawn !== "function") return;
        try {
          spawn();
        } catch (error) {
          caught = error instanceof Error && error.message === "boom";
          restored = kit.getCurrentScope();
        }
      })(),
    );
    expect(caught).toBe(true);
    expect(outer).not.toBeNull();
    expect(restored).toBe(outer);
    expect(kit.getCurrentScope()).toBeNull();
  });

  it("two engines each see their own scope inside their own factory", async () => {
    expect(typeof kit.getCurrentScope).toBe("function");
    const engineA = await openEngine();
    const engineB = await openEngine();
    let scopeA: IGwenScope | null = null;
    let scopeB: IGwenScope | null = null;
    await engineA.use(
      defineSystem("slot-a", () => {
        scopeA = kit.getCurrentScope();
      })(),
    );
    await engineB.use(
      defineSystem("slot-b", () => {
        scopeB = kit.getCurrentScope();
      })(),
    );
    expect(scopeA).not.toBeNull();
    expect(scopeB).not.toBeNull();
    expect(scopeA).not.toBe(scopeB);
    expect(kit.getCurrentScope()).toBeNull();
  });

  it("GwenScope.current() is null when the kit slot holds a foreign IGwenScope", () => {
    expect(typeof kit._setCurrentScope).toBe("function");
    const foreign = foreignScope();
    kit._setCurrentScope(foreign);
    try {
      expect(kit.getCurrentScope()).toBe(foreign);
      expect(GwenScope.current()).toBeNull();
    } finally {
      kit._setCurrentScope(null);
    }
  });
});
