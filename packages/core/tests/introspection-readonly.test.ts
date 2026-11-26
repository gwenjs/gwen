/**
 * @file Dev introspection results are frozen copies. Nothing live is reachable.
 */
import { afterEach, describe, expect, it } from "vitest";
import { GWEN_INTROSPECTION_VERSION, type GwenIntrospection } from "@gwenjs/schema";
import type { GwenEngine, GwenPlugin } from "../src/index.js";
import { createEngine } from "../src/node.js";
import { defineComponent, Types } from "../src/schema.js";
import "./support/plugin-registry";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "probe:counter": { readonly n: number };
  }
}

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  const pending = engines.splice(0);
  for (const engine of pending) await engine.stop();
});

async function rich(): Promise<{
  engine: GwenEngine;
  plugin: GwenPlugin;
  intro: GwenIntrospection | undefined;
  entry: {
    readonly name: "gone";
    readonly extensionApi: { readonly major: number; readonly minor: number };
  };
  entryApi: { readonly major: number; readonly minor: number };
  requires: {
    readonly plugins: readonly (
      | string
      | { readonly name: string; readonly extensionApi: object }
    )[];
    readonly services: readonly string[];
    readonly optional: readonly string[];
  };
  services: readonly string[];
  optional: readonly string[];
  provides: readonly string[];
}> {
  const entryApi = { major: 2, minor: 0 };
  const entry = { name: "gone" as const, extensionApi: entryApi };
  const services = ["logger" as const];
  const optional = ["memory" as const];
  const provides = ["probe:counter" as const];
  const requires = { plugins: ["base" as const, entry], services, optional };
  const base: GwenPlugin = {
    name: "base",
    setup() {},
  };
  const gone: GwenPlugin = {
    name: "gone",
    extensionApi: { major: 2, minor: 1 },
    setup() {},
  };
  const plugin: GwenPlugin = {
    name: "alpha",
    extensionApi: { major: 1, minor: 2 },
    provides,
    requires,
    setup(host) {
      host.provide("probe:counter", { n: 1 });
    },
  };
  const engine = await open();
  await engine.use(base);
  await engine.use(gone);
  await engine.use(plugin);
  const Body = defineComponent({ name: "Body", schema: { x: Types.f32, y: Types.f32 } });
  engine.addComponent(engine.createEntity(), Body, { x: 1, y: 2 });
  await engine.hooks.callHook("scene:enter", "Menu");
  return {
    engine,
    plugin,
    intro: engine.tryInject("introspection"),
    entry,
    entryApi,
    requires,
    services,
    optional,
    provides,
  };
}

function walk(value: unknown, visit: (item: object) => void): void {
  const seen = new Set<object>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === null || typeof current !== "object") continue;
    if (seen.has(current)) continue;
    seen.add(current);
    visit(current);
    if (Array.isArray(current)) {
      for (const item of current) stack.push(item);
      continue;
    }
    for (const item of Object.values(current)) stack.push(item);
  }
}

describe.runIf(__GWEN_DEV__)("introspection read-only", () => {
  it("every returned object and array is deep-frozen", async () => {
    const { intro } = await rich();
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    const returned = [
      intro.limits,
      intro.snapshot(),
      intro.revisions(),
      intro.entities({ offset: 0, limit: 1 }),
      intro.hooks(),
    ];
    for (const value of returned) {
      walk(value, (item) => {
        expect(Object.isFrozen(item)).toBe(true);
      });
    }
    expect(intro.entity(0n)).toBeUndefined();
  });

  it("no service value, plugin object or TypedArray is reachable from a snapshot", async () => {
    const { engine, plugin, intro, entry, entryApi, requires, services, optional, provides } =
      await rich();
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    const banned = new Set<object>([
      plugin,
      engine,
      engine.inject("logger"),
      engine.inject("memory"),
      intro,
    ]);
    if (plugin.extensionApi !== undefined) banned.add(plugin.extensionApi);
    if (plugin.requires !== undefined) banned.add(plugin.requires);
    banned.add(entry);
    banned.add(entryApi);
    banned.add(requires.plugins);
    banned.add(services);
    banned.add(optional);
    banned.add(provides);
    const listed = intro.snapshot().plugins.find((item) => item.name === "alpha");
    expect(listed?.requires.plugins).toEqual([
      "base",
      { name: "gone", extensionApi: { major: 2, minor: 0 } },
    ]);
    let leaked = false;
    walk(intro.snapshot(), (item) => {
      if (banned.has(item) || ArrayBuffer.isView(item)) leaked = true;
    });
    expect(leaked).toBe(false);
  });

  it("the service object rejects property writes", async () => {
    const { intro } = await rich();
    expect(intro).toBeDefined();
    if (intro === undefined) return;
    expect(Reflect.set(intro, "snapshot", null)).toBe(false);
    expect(Reflect.set(intro, "extra", 1)).toBe(false);
    expect(Reflect.deleteProperty(intro, "version")).toBe(false);
    expect(intro.version).toBe(GWEN_INTROSPECTION_VERSION);
  });
});
