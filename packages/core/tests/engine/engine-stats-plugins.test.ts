/**
 * `getStats().hookListeners` and `getStats().plugins` on a real engine.
 * Each test registers listeners through the public hook API and reads the counts back.
 */
import { describe, expect, it } from "vitest";
import { useHook, type GwenPlugin } from "../../src/index";
import { createRealEngine, type RealEngineHandle } from "../../src/testing/create-real-engine.js";

async function openEngine(handles: RealEngineHandle[]): Promise<RealEngineHandle> {
  const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
  handles.push(handle);
  return handle;
}

async function disposeAll(handles: readonly RealEngineHandle[]): Promise<void> {
  for (const handle of handles) await handle.dispose();
}

/** Registers four listeners: one `hooks.hook`, two `useHook`, and one core-tracked hook. */
function listenerPlugin(name: string): GwenPlugin {
  return {
    name,
    setup(engine) {
      engine.hooks.hook("engine:update", () => {});
      useHook("engine:render", () => {});
      useHook("engine:update", () => {});
      engine.hooks.hook("entity:spawn", () => {});
    },
  };
}

describe("EngineStats hookListeners and plugins", () => {
  it("hookListeners and plugins return to baseline after unuse", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const { engine } = await openEngine(handles);
      const baseline = engine.getStats();
      expect(typeof baseline.hookListeners).toBe("number");

      await engine.use(listenerPlugin("p"));
      const used = engine.getStats();
      expect(used.hookListeners).toBe(baseline.hookListeners + 4);
      expect(used.plugins.at(-1)).toBe("p");

      await engine.unuse("p");
      const after = engine.getStats();
      expect(after.hookListeners).toBe(baseline.hookListeners);
      expect(after.plugins).toEqual(baseline.plugins);
    } finally {
      await disposeAll(handles);
    }
  });

  it("hookOnce listener leaves the count after it fires", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const handle = await openEngine(handles);
      const { engine } = handle;
      const baseline = engine.getStats().hookListeners;
      expect(typeof baseline).toBe("number");

      let fired = 0;
      engine.hooks.hookOnce("engine:update", () => {
        fired += 1;
      });
      expect(engine.getStats().hookListeners).toBe(baseline + 1);

      await handle.advance(1, 1 / 60);
      expect(fired).toBe(1);
      expect(engine.getStats().hookListeners).toBe(baseline);

      await handle.advance(1, 1 / 60);
      expect(fired).toBe(1);
      expect(engine.getStats().hookListeners).toBe(baseline);
    } finally {
      await disposeAll(handles);
    }
  });

  it("unuse twice and a plugin off() before unuse never go below baseline", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const { engine } = await openEngine(handles);
      // A listener on the same hook name that stays registered through the whole test.
      engine.hooks.hook("engine:update", () => {});
      const withKeeper = engine.getStats().hookListeners;
      expect(typeof withKeeper).toBe("number");

      // Removing a function that was never registered leaves the count alone.
      engine.hooks.removeHook("engine:update", () => {});
      expect(engine.getStats().hookListeners).toBe(withKeeper);

      let off: (() => void) | undefined;
      await engine.use({
        name: "off-first",
        setup() {
          off = useHook("engine:update", () => {});
        },
      });
      expect(engine.getStats().hookListeners).toBe(withKeeper + 1);

      off?.();
      expect(engine.getStats().hookListeners).toBe(withKeeper);

      await engine.unuse("off-first");
      expect(engine.getStats().hookListeners).toBe(withKeeper);
      await engine.unuse("off-first");
      expect(engine.getStats().hookListeners).toBe(withKeeper);
    } finally {
      await disposeAll(handles);
    }
  });

  it("a hook call with an empty name is not counted", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const { engine } = await openEngine(handles);
      const baseline = engine.getStats().hookListeners;
      expect(typeof baseline).toBe("number");

      const emptyName = String("");
      engine.hooks.hook(emptyName as "engine:update", () => {});
      expect(engine.getStats().hookListeners).toBe(baseline);
    } finally {
      await disposeAll(handles);
    }
  });

  it("two engines count hook listeners independently", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const a = await openEngine(handles);
      const b = await openEngine(handles);
      const baselineA = a.engine.getStats().hookListeners;
      const baselineB = b.engine.getStats().hookListeners;
      expect(typeof baselineA).toBe("number");

      await a.engine.use(listenerPlugin("only-a"));
      expect(a.engine.getStats().hookListeners).toBe(baselineA + 4);
      expect(b.engine.getStats().hookListeners).toBe(baselineB);
      expect(b.engine.getStats().plugins).not.toContain("only-a");
    } finally {
      await disposeAll(handles);
    }
  });

  it("plugins lists install order and each call returns a fresh array", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const { engine } = await openEngine(handles);
      const baseline = engine.getStats().plugins;
      expect(Array.isArray(baseline)).toBe(true);

      await engine.use({ name: "a", setup() {} });
      await engine.use({ name: "b", setup() {} });
      const first = engine.getStats().plugins;
      expect(first.slice(baseline.length)).toEqual(["a", "b"]);

      const second = engine.getStats().plugins;
      expect(second).not.toBe(first);
    } finally {
      await disposeAll(handles);
    }
  });

  it("a fresh engine reports no plugins and a numeric hookListeners", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      const { engine } = await openEngine(handles);
      const stats = engine.getStats();
      expect(stats.plugins).toEqual([]);
      expect(typeof stats.hookListeners).toBe("number");
    } finally {
      await disposeAll(handles);
    }
  });
});
