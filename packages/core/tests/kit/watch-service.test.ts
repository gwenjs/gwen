import { afterEach, describe, expect, it } from "vitest";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import { GwenContextError } from "@gwenjs/kit";
import * as plugin from "@gwenjs/kit/plugin";
import type { GwenEngineBase } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p72:marker": { readonly n: number };
  }
}

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

function watch(): typeof plugin.watchService {
  expect(typeof plugin.watchService).toBe("function");
  return plugin.watchService;
}

function usePlugin(engine: GwenEngine, name: string, setup: (host: GwenEngineBase) => void) {
  return engine.use(plugin.definePlugin(() => ({ name, setup }))());
}

describe("watchService and optionalService", () => {
  it("watchService inside setup reads the logger once", async () => {
    const engine = await open();
    const seen: unknown[] = [];
    await usePlugin(engine, "watch-logger", () => watch()("logger", (value) => seen.push(value)));
    expect(seen).toEqual([engine.logger]);
  });
  it("the first watchService callback provides and sees undefined then the marker", async () => {
    const engine = await open();
    const marker = { n: 7 };
    const seen: unknown[] = [];
    await usePlugin(engine, "watch-fill", (host) => {
      watch()("p72:marker", (value) => {
        seen.push(value);
        if (value === undefined) host.provide("p72:marker", marker);
      });
    });
    expect(seen).toEqual([undefined, marker]);
  });
  it("unuse ends watchService with undefined; the same reference again stays at 1", async () => {
    const engine = await open();
    const marker = { n: 2 };
    const next = { n: 4 };
    const seen: unknown[] = [];
    await usePlugin(engine, "watcher", () => watch()("p72:marker", (value) => seen.push(value)));
    await usePlugin(engine, "provider", (host) => host.provide("p72:marker", marker));
    engine.provide("p72:marker", marker);
    expect(seen).toEqual([undefined, marker]);
    await usePlugin(engine, "replacer", (host) => host.provide("p72:marker", next));
    expect(seen).toEqual([undefined, marker, next]);
    await engine.unuse("replacer");
    expect(seen).toEqual([undefined, marker, next, undefined]);
  });
  it("disposer stops watchService; listener increments; unuse of the consumer", async () => {
    const engine = await open();
    let hooks = 0;
    let stopped = 0;
    let calls = 0;
    let stop: (() => void) | undefined;
    engine.hooks.hook("service:provided", () => (hooks += 1));
    await usePlugin(engine, "stop", () => {
      stop = watch()("p72:marker", () => (stopped += 1));
    });
    await usePlugin(engine, "consumer", () => watch()("p72:marker", () => (calls += 1)));
    expect(stopped).toBe(1);
    expect(calls).toBe(1);
    stop?.();
    engine.provide("p72:marker", { n: 1 });
    expect(stopped).toBe(1);
    expect(hooks).toBe(1);
    expect(calls).toBe(2);
    await engine.unuse("consumer");
    engine.provide("p72:marker", { n: 2 });
    expect(calls).toBe(2);
  });
  it("optionalService current reads undefined, then the value, then undefined", async () => {
    expect(typeof plugin.optionalService).toBe("function");
    const engine = await open();
    const marker = { n: 5 };
    const slot = plugin.optionalService(engine, "p72:marker");
    expect(slot.current).toBeUndefined();
    await usePlugin(engine, "provider", (host) => host.provide("p72:marker", marker));
    expect(slot.current).toBe(marker);
    await engine.unuse("provider");
    expect(slot.current).toBeUndefined();
  });
  it("watchService outside a context throws CORE:OUTSIDE_ENGINE_CONTEXT", () => {
    expect(typeof plugin.watchService).toBe("function");
    let code = "";
    try {
      plugin.watchService("logger", () => {});
    } catch (error: unknown) {
      if (error instanceof GwenContextError) code = error.code;
    }
    expect(code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
  });
});
