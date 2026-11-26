/**
 * @file Dev introspection snapshot: plugins, services, components, phases, revisions.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GWEN_INTROSPECTION_VERSION } from "@gwenjs/schema";
import type { GwenEngine, GwenEngineOptions, GwenPlugin } from "../src/index.js";
import { createEngine } from "../src/node.js";
import { hotReplaceSystem } from "../src/internal.js";
import { defineComponent, Types } from "../src/schema.js";
import { createSystemHandle } from "../src/scene/runtime/system-handle.js";
import { defineSystem, onRender, onUpdate } from "../src/system/index.js";
import "./support/plugin-registry";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "probe:counter": { readonly n: number };
  }
}

type PageOptions = GwenEngineOptions & { readonly introspection?: unknown };

const ENGINE_KEYS = [
  "wasm:bridge",
  "logger",
  "errors",
  "memory",
  "transform:2d",
  "transform:3d",
  "introspection",
] as const;

const engines: GwenEngine[] = [];

async function open(options?: PageOptions): Promise<GwenEngine> {
  const engine = await createEngine(options);
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

describe("introspection snapshot", () => {
  it.runIf(__GWEN_DEV__)(
    "dev engine provides introspection with the installed plugins in order",
    async () => {
      const alpha: GwenPlugin = { name: "alpha", setup() {} };
      const beta: GwenPlugin = {
        name: "beta",
        requires: { services: ["logger"], optional: ["memory"] },
        setup() {},
      };
      const engine = await open();
      await engine.use(alpha);
      await engine.use(beta);
      const intro = engine.tryInject("introspection");
      expect(intro?.version).toBe(GWEN_INTROSPECTION_VERSION);
      if (intro === undefined) return;
      const shot = intro.snapshot();
      expect(shot.debug).toBe(false);
      expect(shot.timing).toBe(false);
      expect(shot.plugins).toEqual([
        {
          name: "alpha",
          provides: [],
          requires: { plugins: [], services: [], optional: [] },
          extensionApi: null,
          isolated: false,
        },
        {
          name: "beta",
          provides: [],
          requires: { plugins: [], services: ["logger"], optional: ["memory"] },
          extensionApi: null,
          isolated: false,
        },
      ]);
    },
  );

  it.runIf(__GWEN_DEV__)("a plugin lists its extension API and the base it extends", async () => {
    const base: GwenPlugin = {
      name: "base",
      extensionApi: { major: 2, minor: 1 },
      setup() {},
    };
    const ext: GwenPlugin = {
      name: "ext",
      requires: { plugins: [{ name: "base", extensionApi: { major: 2, minor: 0 } }] },
      setup() {},
    };
    const engine = await open();
    await engine.use(base);
    await engine.use(ext);
    const intro = engine.tryInject("introspection");
    const plugins = intro?.snapshot()?.plugins;
    const listedBase = plugins?.find((plugin) => plugin.name === "base");
    const listedExt = plugins?.find((plugin) => plugin.name === "ext");
    expect(listedBase?.extensionApi).toEqual({ major: 2, minor: 1 });
    if (intro === undefined) return;
    expect(listedExt?.requires.plugins).toEqual([
      { name: "base", extensionApi: { major: 2, minor: 0 } },
    ]);
  });

  it.runIf(__GWEN_DEV__)(
    "services list key and owner, the seven engine keys owned by <engine>",
    async () => {
      const engine = await open();
      const intro = engine.tryInject("introspection");
      const services = intro?.snapshot()?.services;
      expect(services).toEqual(ENGINE_KEYS.map((key) => ({ key, owner: "<engine>" })));
    },
  );

  it.runIf(__GWEN_DEV__)("a plugin that provides a service owns its key", async () => {
    const tweens: GwenPlugin = {
      name: "tweens",
      provides: ["probe:counter"],
      setup(host) {
        host.provide("probe:counter", { n: 1 });
      },
    };
    const engine = await open();
    await engine.use(tweens);
    const intro = engine.tryInject("introspection");
    const owner = intro
      ?.snapshot()
      ?.services?.find((service) => service.key === "probe:counter")?.owner;
    expect(owner).toBe("tweens");
  });

  it.runIf(__GWEN_DEV__)(
    "components list registered names with fields in schema order",
    async () => {
      const Body = defineComponent({
        name: "Body",
        schema: { x: Types.f32, y: Types.f32, mass: Types.f32 },
      });
      const Tag = defineComponent({
        name: "Tag",
        schema: { kind: Types.f32 },
      });
      const engine = await open();
      const id = engine.createEntity();
      engine.addComponent(id, Body, { x: 1, y: 2, mass: 3 });
      engine.addComponent(id, Tag, { kind: 1 });
      engine.getOrRegisterComponent("Bare");
      const intro = engine.tryInject("introspection");
      const components = intro?.snapshot()?.components;
      expect(components?.map((component) => [component.name, [...component.fields]])).toEqual([
        ["Body", ["x", "y", "mass"]],
        ["Tag", ["kind"]],
        ["Bare", []],
      ]);
      if (intro === undefined) return;
      const body = intro.snapshot().components.find((component) => component.name === "Body");
      expect(body?.typeId).toBe(engine.registeredComponentTypes().get("Body"));
      expect(intro.snapshot().entityCount).toBe(1);
    },
  );

  it.runIf(__GWEN_DEV__)(
    "phases list system ids in dispatch order and drop an unsubscribed system",
    async () => {
      const first = defineSystem("first", () => {
        onUpdate(() => {});
        onUpdate(() => {});
        onRender(() => {});
      });
      const second = defineSystem("second", () => {
        onUpdate(() => {});
      });
      const engine = await open();
      await engine.use(first());
      await engine.use(second());
      const intro = engine.tryInject("introspection");
      const before = intro?.snapshot();
      const firstId = before?.systems.find((system) => system.name === "first")?.id;
      const secondId = before?.systems.find((system) => system.name === "second")?.id;
      expect(before?.phases.update).toEqual([firstId, firstId, secondId]);
      if (intro === undefined || before === undefined) return;
      expect(before.phases.render).toEqual([firstId]);
      expect(before.phases.beforeUpdate).toEqual([]);
      expect(before.phases.afterUpdate).toEqual([]);
      expect(before.systems.map((system) => system.name)).toEqual(["first", "second"]);
      await engine.unuse("first");
      const after = intro.snapshot();
      expect(after.systems.map((system) => system.name)).toEqual(["second"]);
      expect(after.phases.update).toEqual([secondId]);
      expect(after.phases.render).toEqual([]);
    },
  );

  it.runIf(__GWEN_DEV__)(
    "an isolated system is listed isolated after its handler throws",
    async () => {
      const boom = defineSystem("boom", () => {
        onUpdate(() => {
          throw new Error("boom");
        });
      });
      const engine = await open();
      await engine.use(boom());
      const intro = engine.tryInject("introspection");
      const before = intro?.snapshot()?.systems.find((system) => system.name === "boom");
      expect(before?.isolated).toBe(false);
      if (intro === undefined) return;
      const systemsBefore = intro.revisions().systems;
      await engine.startExternal();
      await engine.advance(1 / 60);
      const after = intro.snapshot().systems.find((system) => system.name === "boom");
      expect(after?.isolated).toBe(true);
      expect(intro.revisions().systems).toBe(systemsBefore + 1);
    },
  );

  it.runIf(__GWEN_DEV__)("revisions move only for the section that changed", async () => {
    const engine = await open();
    const intro = engine.tryInject("introspection");
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    const first = intro.revisions();
    const second = intro.revisions();
    expect(second).toEqual(first);
    await engine.use({ name: "alpha", setup() {} });
    const afterPlugin = intro.revisions();
    expect(afterPlugin.plugins).toBe(first.plugins + 1);
    expect(afterPlugin.services).toBe(first.services);
    expect(afterPlugin.components).toBe(first.components);
    expect(afterPlugin.systems).toBe(first.systems);
    expect(afterPlugin.scenes).toBe(first.scenes);
    expect(afterPlugin.hooks).toBe(0);
    expect(afterPlugin.frame).toBe(first.frame);
    const tweens: GwenPlugin = {
      name: "tweens",
      provides: ["probe:counter"],
      setup(host) {
        host.provide("probe:counter", { n: 1 });
      },
    };
    await engine.use(tweens);
    const afterService = intro.revisions();
    expect(afterService.plugins).toBe(afterPlugin.plugins + 1);
    expect(afterService.services).toBe(afterPlugin.services + 1);
    expect(afterService.components).toBe(afterPlugin.components);

    const marker = defineSystem("marker", () => {
      onUpdate(() => {});
    });
    const wrapped = createSystemHandle(marker());
    await engine.use(wrapped.plugin);
    const afterSystem = intro.revisions();
    expect(afterSystem.systems).toBe(afterService.systems + 1);
    expect(afterSystem.plugins).toBe(afterService.plugins + 1);
    expect(afterSystem.services).toBe(afterService.services);
    expect(afterSystem.components).toBe(afterService.components);
    expect(afterSystem.scenes).toBe(afterService.scenes);
    expect(afterSystem.frame).toBe(afterService.frame);
    expect(afterSystem.hooks).toBe(0);
    wrapped.handle.pause();
    const afterPause = intro.revisions();
    expect(afterPause.systems).toBe(afterSystem.systems + 1);
    expect(intro.snapshot().systems.find((system) => system.name === "marker")?.paused).toBe(true);
    expect(afterPause.plugins).toBe(afterSystem.plugins);
    expect(afterPause.components).toBe(afterSystem.components);
    expect(afterPause.scenes).toBe(afterSystem.scenes);
    expect(afterPause.services).toBe(afterSystem.services);
    expect(afterPause.frame).toBe(afterSystem.frame);
    const Rev = defineComponent({ name: "Rev", schema: { x: Types.f32 } });
    engine.addComponent(engine.createEntity(), Rev, { x: 1 });
    const afterComponent = intro.revisions();
    expect(afterComponent.components).toBe(afterPause.components + 1);
    expect(afterComponent.systems).toBe(afterPause.systems);
    expect(afterComponent.plugins).toBe(afterPause.plugins);
    expect(afterComponent.services).toBe(afterPause.services);
    expect(afterComponent.scenes).toBe(afterPause.scenes);
    await engine.hooks.callHook("scene:enter", "Menu");
    const afterEnter = intro.revisions();
    expect(afterEnter.scenes).toBe(afterComponent.scenes + 1);
    expect(afterEnter.systems).toBe(afterComponent.systems);
    expect(afterEnter.components).toBe(afterComponent.components);
    expect(afterEnter.plugins).toBe(afterComponent.plugins);
    await engine.hooks.callHook("scene:leave", "Menu");
    const afterLeave = intro.revisions();
    expect(afterLeave.scenes).toBe(afterEnter.scenes + 1);
    expect(afterLeave.components).toBe(afterEnter.components);
    expect(afterLeave.systems).toBe(afterEnter.systems);
    await engine.startExternal();
    const beforeFrame = intro.revisions();
    await engine.advance(1 / 60);
    const afterFrame = intro.revisions();
    expect(afterFrame.frame).toBeGreaterThan(beforeFrame.frame);
    expect(afterFrame.scenes).toBe(beforeFrame.scenes);
    expect(afterFrame.systems).toBe(beforeFrame.systems);
    expect(afterFrame.plugins).toBe(beforeFrame.plugins);
    expect(afterFrame.components).toBe(beforeFrame.components);
  });

  it.runIf(__GWEN_DEV__)(
    "debug, a paused system, an isolated plugin, a null owner and a faulted count",
    async () => {
      const debugEngine = await open({ debug: true });
      const debugShot = debugEngine.tryInject("introspection")?.snapshot();
      expect(debugShot?.debug).toBe(true);
      expect(debugShot?.timing).toBe(true);

      const paused = defineSystem("paused", () => {
        onUpdate(() => {});
      });
      const handle = createSystemHandle(paused());
      await debugEngine.use(handle.plugin);
      handle.handle.pause();
      const pausedRow = debugEngine
        .tryInject("introspection")
        ?.snapshot()
        .systems.find((system) => system.name === "paused");
      expect(pausedRow?.paused).toBe(true);

      const noisy: GwenPlugin = {
        name: "noisy",
        setup(host) {
          host.hooks.hook("engine:update", () => {
            throw new Error("noisy");
          });
        },
      };
      const engine = await open();
      await engine.use(noisy);
      const intro = engine.tryInject("introspection");
      expect(intro).toBeDefined();
      if (intro === undefined) return;
      expect(intro.snapshot().plugins.find((plugin) => plugin.name === "noisy")?.isolated).toBe(
        false,
      );
      await engine.startExternal();
      await engine.advance(1 / 60);
      expect(intro.snapshot().plugins.find((plugin) => plugin.name === "noisy")?.isolated).toBe(
        true,
      );

      engine.provide("probe:counter", { n: 0 });
      const owner = intro
        .snapshot()
        .services.find((service) => service.key === "probe:counter")?.owner;
      expect(owner).toBeNull();

      const faulted = await open();
      faulted.createEntity();
      faulted.hooks.hook("engine:update", () => {
        throw new WebAssembly.RuntimeError("panic");
      });
      const faultIntro = faulted.tryInject("introspection");
      expect(faultIntro).toBeDefined();
      if (faultIntro === undefined) return;
      await faulted.startExternal();
      await faulted.advance(1 / 60);
      const faultShot = faultIntro.snapshot();
      expect(faultShot.state).toBe("faulted");
      expect(faultShot.entityCount).toBe(0);
    },
  );

  it.runIf(__GWEN_DEV__)("a hot-swapped system keeps its place between two systems", async () => {
    const engine = await open();
    const once = (name: string) =>
      defineSystem(name, () => {
        onUpdate(() => {});
      });
    const twice = (name: string) =>
      defineSystem(name, () => {
        onUpdate(() => {});
        onUpdate(() => {});
      });
    const left = once("left");
    const mid = twice("mid");
    const right = once("right");
    const midNext = twice("mid");
    await engine.use(left());
    await engine.use(mid());
    await engine.use(right());
    const intro = engine.tryInject("introspection");
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    const order = (phase: readonly string[], rows: readonly { id: string; name: string }[]) => {
      const names = new Map(rows.map((row) => [row.id, row.name]));
      return phase.map((id) => names.get(id));
    };
    const before = intro.snapshot();
    expect(order(before.phases.update, before.systems)).toEqual(["left", "mid", "mid", "right"]);
    await hotReplaceSystem(mid, midNext);
    const after = intro.snapshot();
    expect(order(after.phases.update, after.systems)).toEqual(["left", "mid", "mid", "right"]);
  });

  it("the service exists only in a dev build, and createEngine validates maxPageSize in both", async () => {
    const engine = await open();
    expect(engine.tryInject("introspection") !== undefined).toBe(__GWEN_DEV__);
    const bad: PageOptions = { introspection: { maxPageSize: 0 } };
    let caught: unknown;
    try {
      engines.push(await createEngine(bad));
    } catch (error: unknown) {
      caught = error;
    }
    expect(caught).toMatchObject({
      code: "CORE:INVALID_CONFIG",
      field: "introspection.maxPageSize",
    });
  });
});
