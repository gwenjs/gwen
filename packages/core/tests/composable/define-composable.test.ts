/**
 * defineComposable — composable context validation.
 *
 * Verifies that defineComposable() restricts call sites to the declared
 * ComposableContext and throws GwenContextError with code 'WRONG_CONTEXT'
 * when called from the wrong context.
 */

import { describe, it, expect } from "vitest";
import { createEngine, GwenContextError } from "../../src/index";
import { defineSystem, onUpdate } from "../../src/system/defines/define-system";
import { defineActor } from "../../src/actor/defines/define-actor";
import { definePrefab } from "../../src/actor/defines/define-prefab";
import { defineScene } from "../../src/scene/defines/define-scene";
import { defineComposable } from "../../src/composable/context";

const Pos = { __name__: "Pos" };
const SimplePrefab = definePrefab([{ def: Pos, defaults: { x: 0 } }]);

// ─── engine context ───────────────────────────────────────────────────────────

describe("defineComposable('engine')", () => {
  it("valid inside engine.run()", async () => {
    const engine = await createEngine();
    const fn = defineComposable("engine", () => 42);
    expect(engine.run(() => fn())).toBe(42);
  });

  it("valid inside plugin setup()", async () => {
    const engine = await createEngine();
    const fn = defineComposable("engine", () => "plugin");
    let result: string;
    await engine.use({
      name: "P",
      setup() {
        result = fn();
      },
    });
    expect(result!).toBe("plugin");
  });

  it("valid inside defineSystem() factory", async () => {
    const engine = await createEngine();
    const fn = defineComposable("engine", () => "sys");
    let result: string;
    const Sys = defineSystem(() => {
      result = fn();
      onUpdate(() => {});
    });
    await engine.use(Sys());
    expect(result!).toBe("sys");
  });

  it("valid inside defineActor() factory", async () => {
    const engine = await createEngine();
    const fn = defineComposable("engine", () => "actor");
    let result: string;
    const Actor = defineActor(SimplePrefab, () => {
      result = fn();
      return {};
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
    expect(result!).toBe("actor");
  });

  it("valid inside defineScene() factory", () => {
    const fn = defineComposable("engine", () => "scene");
    let result: string;
    const S = defineScene("S", () => {
      result = fn();
    });
    S({ register: () => {} }); // triggers the factory
    expect(result!).toBe("scene");
  });

  it("throws GwenContextError with code WRONG_CONTEXT outside any context", () => {
    const fn = defineComposable("engine", () => 1);
    expect(() => fn()).toThrow(GwenContextError);
    try {
      fn();
    } catch (e) {
      expect((e as GwenContextError).code).toBe("WRONG_CONTEXT");
    }
  });
});

// ─── system context ───────────────────────────────────────────────────────────

describe("defineComposable('system')", () => {
  it("valid inside defineSystem() factory", async () => {
    const engine = await createEngine();
    const fn = defineComposable("system", () => "sys");
    let result: string;
    const Sys = defineSystem(() => {
      result = fn();
      onUpdate(() => {});
    });
    await engine.use(Sys());
    expect(result!).toBe("sys");
  });

  it("valid inside defineActor() factory (actor implies system)", async () => {
    const engine = await createEngine();
    const fn = defineComposable("system", () => "sys-in-actor");
    let result: string;
    const Actor = defineActor(SimplePrefab, () => {
      result = fn();
      return {};
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
    expect(result!).toBe("sys-in-actor");
  });

  it("throws WRONG_CONTEXT inside engine.run()", async () => {
    const engine = await createEngine();
    const fn = defineComposable("system", () => "sys");
    expect(() => engine.run(() => fn())).toThrow(GwenContextError);
    engine.run(() => {
      try {
        fn();
      } catch (e) {
        expect((e as GwenContextError).code).toBe("WRONG_CONTEXT");
      }
    });
  });

  it("throws WRONG_CONTEXT inside defineScene() factory", () => {
    const fn = defineComposable("system", () => "sys");
    let caughtCode: string | undefined;
    const S = defineScene("SysInScene", () => {
      try {
        fn();
      } catch (e) {
        caughtCode = (e as GwenContextError).code;
      }
    });
    S({ register: () => {} });
    expect(caughtCode).toBe("WRONG_CONTEXT");
  });
});

// ─── actor context ────────────────────────────────────────────────────────────

describe("defineComposable('actor')", () => {
  it("valid inside defineActor() factory", async () => {
    const engine = await createEngine();
    const fn = defineComposable("actor", () => "actor-ok");
    let result: string;
    const Actor = defineActor(SimplePrefab, () => {
      result = fn();
      return {};
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
    expect(result!).toBe("actor-ok");
  });

  it("throws WRONG_CONTEXT inside defineSystem() factory", async () => {
    const engine = await createEngine();
    const fn = defineComposable("actor", () => "actor");
    let caughtCode: string | undefined;
    const Sys = defineSystem(() => {
      try {
        fn();
      } catch (e) {
        caughtCode = (e as GwenContextError).code;
      }
      onUpdate(() => {});
    });
    await engine.use(Sys());
    expect(caughtCode).toBe("WRONG_CONTEXT");
  });

  it("throws WRONG_CONTEXT inside engine.run()", async () => {
    const engine = await createEngine();
    const fn = defineComposable("actor", () => "actor");
    expect(() => engine.run(() => fn())).toThrow(GwenContextError);
  });
});

// ─── scene context ────────────────────────────────────────────────────────────

describe("defineComposable('scene')", () => {
  it("valid inside defineScene() factory", () => {
    const fn = defineComposable("scene", () => "scene-ok");
    let result: string;
    const S = defineScene("SceneCtx", () => {
      result = fn();
    });
    S({ register: () => {} });
    expect(result!).toBe("scene-ok");
  });

  it("throws WRONG_CONTEXT inside engine.run()", async () => {
    const engine = await createEngine();
    const fn = defineComposable("scene", () => "scene");
    expect(() => engine.run(() => fn())).toThrow(GwenContextError);
  });

  it("throws WRONG_CONTEXT inside defineSystem() factory", async () => {
    const engine = await createEngine();
    const fn = defineComposable("scene", () => "scene");
    let caughtCode: string | undefined;
    const Sys = defineSystem(() => {
      try {
        fn();
      } catch (e) {
        caughtCode = (e as GwenContextError).code;
      }
      onUpdate(() => {});
    });
    await engine.use(Sys());
    expect(caughtCode).toBe("WRONG_CONTEXT");
  });
});

// ─── error message quality ────────────────────────────────────────────────────

describe("defineComposable — error message", () => {
  it("error message includes [GWEN] prefix and context info", async () => {
    const engine = await createEngine();
    const fn = defineComposable("actor", () => {});
    let msg: string | undefined;
    engine.run(() => {
      try {
        fn();
      } catch (e) {
        msg = (e as Error).message;
      }
    });
    expect(msg).toMatch(/\[GWEN\]/);
    expect(msg).toMatch(/actor/);
  });
});
