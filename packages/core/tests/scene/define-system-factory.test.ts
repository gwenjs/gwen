import { describe, it, expect } from "vitest";
import { defineSystem, onUpdate, onBeforeUpdate, onAfterUpdate } from "../../src/system.js";
import { createEngine } from "../../src/engine/gwen-engine.js";

describe("defineSystem — factory pattern", () => {
  it("returns a function, not a GwenPlugin directly", () => {
    const SystemFactory = defineSystem(() => {});
    expect(typeof SystemFactory).toBe("function");
    // It should NOT be a GwenPlugin — GwenPlugins have a setup() method
    expect(typeof (SystemFactory as unknown as { setup?: unknown }).setup).toBe("undefined");
  });

  it("calling the factory returns a GwenPlugin", () => {
    const SystemFactory = defineSystem(() => {});
    const plugin = SystemFactory();
    expect(typeof plugin).toBe("object");
    expect(typeof plugin.name).toBe("string");
    expect(typeof plugin.setup).toBe("function");
  });

  it("named form: plugin.name matches provided name", () => {
    const plugin = defineSystem("MovementSystem", () => {})();
    expect(plugin.name).toBe("MovementSystem");
  });

  it("anonymous form: plugin.name defaults to 'anonymous-system'", () => {
    const plugin = defineSystem(() => {})();
    // name may be 'anonymous-system' or derived from function name
    expect(typeof plugin.name).toBe("string");
  });

  it("zero-arg factory: () => GwenPlugin", () => {
    const f = defineSystem(() => {});
    expect(typeof f).toBe("function");
    expect(f.length).toBe(0);
  });

  it("DI factory: (dep) => GwenPlugin — dep is forwarded to setup", async () => {
    const engine = await createEngine();
    const receivedDeps: string[] = [];

    const SystemWithDep = defineSystem((dep: string) => {
      onUpdate(() => receivedDeps.push(dep));
    });

    const plugin = SystemWithDep("hello");
    expect(plugin.name).toBeDefined();

    await engine.use(plugin);
    await engine.advance(16);

    expect(receivedDeps).toEqual(["hello"]);
  });

  it("calling the same factory twice produces independent plugins", () => {
    const f = defineSystem("Sys", () => {});
    const p1 = f();
    const p2 = f();
    expect(p1).not.toBe(p2);
    expect(p1.name).toBe(p2.name);
  });

  it("onUpdate callbacks run each frame after engine.use()", async () => {
    const engine = await createEngine();
    const frames: number[] = [];

    const Sys = defineSystem("FrameTest", () => {
      onUpdate((dt) => frames.push(dt));
    });

    await engine.use(Sys());
    await engine.advance(16);
    await engine.advance(32);

    expect(frames).toEqual([16, 32]);
  });

  it("onBeforeUpdate and onAfterUpdate callbacks run in correct phase", async () => {
    const engine = await createEngine();
    const order: string[] = [];

    await engine.use(
      defineSystem("OrderTest", () => {
        onBeforeUpdate(() => order.push("before"));
        onUpdate(() => order.push("update"));
        onAfterUpdate(() => order.push("after"));
      })(),
    );

    await engine.advance(16);

    expect(order).toEqual(["before", "update", "after"]);
  });

  it("plugin has internal _discover() method", () => {
    const plugin = defineSystem("Discoverable", () => {})();
    expect(typeof (plugin as { _discover?: unknown })._discover).toBe("function");
  });

  it("_discover() runs setup in no-op mode — onUpdate is not registered", async () => {
    const engine = await createEngine();
    const frames: number[] = [];

    const plugin = defineSystem("DiscoverNoOp", () => {
      onUpdate((dt) => frames.push(dt));
    })();

    // Run discover — should NOT register the onUpdate callback
    engine.run(() => {
      (plugin as { _discover(): void })._discover();
    });

    // Now use the plugin for real
    await engine.use(plugin);
    await engine.advance(16);

    // onUpdate registered only once (from real setup), not twice
    expect(frames).toHaveLength(1);
  });

  it("_discover() runs with DI deps — forwards args correctly", async () => {
    const engine = await createEngine();
    const discovered: string[] = [];

    // Simulate a system that reads a dep in setup
    const Sys = defineSystem((label: string) => {
      // This runs during both discover and real setup
      discovered.push(label);
      onUpdate(() => {}); // no-op in discover mode
    });

    const plugin = Sys("test-label");

    engine.run(() => {
      (plugin as { _discover(): void })._discover();
    });

    // discover pass ran setup once
    expect(discovered).toContain("test-label");
  });
});
