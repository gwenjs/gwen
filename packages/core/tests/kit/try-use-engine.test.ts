/**
 * @file `tryUseEngine` reads the same engine as `useEngine`, or `undefined` where that call throws (P-76-5b).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { GwenEngineBase } from "@gwenjs/schema";
import { createEngine, createEngineLocal, defineComponent, Types, useEngine } from "@gwenjs/core";
import { engineContext, executeAsync } from "@gwenjs/core/internal";
import { defineSystem } from "@gwenjs/core/system";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { defineScene } from "@gwenjs/core/scene";
import { definePlugin } from "@gwenjs/kit/plugin";
import * as kit from "@gwenjs/kit";

const tryUseEngine: unknown = Reflect.get(kit, "tryUseEngine");

const engines: { stop: () => Promise<void> }[] = [];

afterEach(async () => {
  engineContext.unset();
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

function isTryUseEngine(value: unknown): value is () => GwenEngineBase | undefined {
  return typeof value === "function";
}

function isGwenEngineBase(value: unknown): value is GwenEngineBase {
  if (typeof value !== "object" || value === null) return false;
  if (!("run" in value) || typeof value.run !== "function") return false;
  if (!("stop" in value) || typeof value.stop !== "function") return false;
  if (!("activate" in value) || typeof value.activate !== "function") return false;
  return "hooks" in value && typeof value.hooks === "object" && value.hooks !== null;
}

/** Call the kit export when it is a function. Throws an assertion error otherwise. */
function callTryUseEngine(): GwenEngineBase | undefined {
  expect(typeof tryUseEngine).toBe("function");
  if (!isTryUseEngine(tryUseEngine)) {
    throw new Error("tryUseEngine is not a function");
  }
  const value: unknown = tryUseEngine();
  if (value === undefined) return undefined;
  expect(isGwenEngineBase(value)).toBe(true);
  if (!isGwenEngineBase(value)) {
    throw new Error("tryUseEngine did not return an engine");
  }
  return value;
}

/** `useEngine()` at this point, or `undefined` when it throws `CORE:OUTSIDE_ENGINE_CONTEXT`. */
function engineFromUseEngine(): GwenEngineBase | undefined {
  try {
    return useEngine();
  } catch (error) {
    if (
      error instanceof kit.GwenContextError &&
      error.code === kit.GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT
    ) {
      return undefined;
    }
    throw error;
  }
}

function expectCurrent(expected: GwenEngineBase | undefined): void {
  const tried = callTryUseEngine();
  const current = engineFromUseEngine();
  expect(tried).toBe(current);
  expect(tried).toBe(expected);
}

async function openEngine() {
  const engine = await createEngine({ maxEntities: 32 });
  engines.push(engine);
  return engine;
}

describe("tryUseEngine", () => {
  it("returns undefined outside any context", () => {
    expect(typeof tryUseEngine).toBe("function");
    expectCurrent(undefined);
  });

  it("returns the engine inside engine.run and undefined after it", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engine = await openEngine();
    engine.run(() => {
      expectCurrent(engine);
    });
    expectCurrent(undefined);
  });

  it("nested runs: B inside A, then A again", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engineA = await openEngine();
    const engineB = await openEngine();
    engineA.run(() => {
      expectCurrent(engineA);
      engineB.run(() => {
        expectCurrent(engineB);
      });
      expectCurrent(engineA);
    });
    expectCurrent(undefined);
  });

  it("executeAsync restores the engine after an await", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engineA = await openEngine();
    const engineB = await openEngine();
    let duringTry: GwenEngineBase | undefined;
    let duringUse: GwenEngineBase | undefined;
    engineA.activate();
    const [pending, restore] = executeAsync(async () => {
      await Promise.resolve();
      duringTry = callTryUseEngine();
      duringUse = engineFromUseEngine();
    });
    engineB.activate();
    await pending;
    expect(duringTry).toBe(engineB);
    expect(duringUse).toBe(engineB);
    expect(duringTry).toBe(duringUse);
    restore();
    expectCurrent(engineA);
  });

  it("engine-local use() and tryUseEngine name the same engine", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engine = await openEngine();
    const slot = createEngineLocal((current) => current);
    engine.run(() => {
      const named = slot.use();
      expect(callTryUseEngine()).toBe(named);
      expect(engineFromUseEngine()).toBe(named);
    });
  });

  it("activate / deactivate", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engine = await openEngine();
    engine.activate();
    expectCurrent(engine);
    engine.deactivate();
    expectCurrent(undefined);
  });

  it("two engines: B.run inside A.activate returns B, then A", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engineA = await openEngine();
    const engineB = await openEngine();
    engineA.activate();
    engineB.run(() => {
      expectCurrent(engineB);
    });
    expectCurrent(engineA);
    engineA.deactivate();
  });

  it("inside a system factory and a plugin setup", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engine = await openEngine();
    let systemEngine: GwenEngineBase | undefined;
    let systemMatched = false;
    let pluginEngine: GwenEngineBase | undefined;
    let pluginMatched = false;
    await engine.use(
      defineSystem("TryUseSystem", () => {
        systemEngine = callTryUseEngine();
        systemMatched = systemEngine === engineFromUseEngine();
      })(),
    );
    await engine.use(
      definePlugin(() => ({
        name: "try-use-plugin",
        setup() {
          pluginEngine = callTryUseEngine();
          pluginMatched = pluginEngine === engineFromUseEngine();
        },
      }))(),
    );
    expect(systemMatched).toBe(true);
    expect(systemEngine).toBe(engine);
    expect(pluginMatched).toBe(true);
    expect(pluginEngine).toBe(engine);
  });

  it("inside an actor factory and a scene factory", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engine = await openEngine();
    const position = defineComponent({
      name: "TryUseEnginePos",
      schema: { x: Types.f32, y: Types.f32 },
    });
    const prefab = definePrefab([{ def: position, defaults: { x: 0, y: 0 } }]);
    let actorEngine: GwenEngineBase | undefined;
    let actorMatched = false;
    const actor = defineActor("TryUseActor", prefab, () => {
      actorEngine = callTryUseEngine();
      actorMatched = actorEngine === engineFromUseEngine();
    });
    await engine.use(actor._plugin);
    engine.run(() => {
      actor._plugin.spawn();
    });
    expect(actorMatched).toBe(true);
    expect(actorEngine).toBe(engine);

    let sceneEngine: GwenEngineBase | undefined;
    let sceneMatched = false;
    const scene = defineScene("try-use-scene", () => {
      sceneEngine = callTryUseEngine();
      sceneMatched = sceneEngine === engineFromUseEngine();
    });
    engine.run(() => {
      scene({
        register() {},
      });
    });
    expect(sceneMatched).toBe(true);
    expect(sceneEngine).toBe(engine);
  });

  it("after stop it returns undefined outside run", async () => {
    expect(typeof tryUseEngine).toBe("function");
    const engine = await openEngine();
    engine.run(() => {
      expectCurrent(engine);
    });
    await engine.stop();
    expectCurrent(undefined);
  });
});
