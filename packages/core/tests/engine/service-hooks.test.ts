import { afterEach, describe, expect, it } from "vitest";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import { definePlugin } from "@gwenjs/kit/plugin";
import type { GwenEngineBase, GwenErrorPayload } from "@gwenjs/schema";

declare module "@gwenjs/schema" {
  interface GwenProvides {
    "p72:alpha": { readonly n: number };
    "p72:beta": { readonly n: number };
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

function install(
  engine: GwenEngine,
  name: string,
  setup: (host: GwenEngineBase) => void | Promise<void>,
  requires?: { services?: readonly string[]; optional?: readonly string[] },
  teardown?: () => void,
): Promise<void> {
  return engine.use(
    definePlugin(() => ({
      name,
      setup,
      ...(teardown === undefined ? {} : { teardown }),
      ...(requires === undefined ? {} : { requires }),
    }))(),
  );
}

const give = (key: "p72:alpha" | "p72:beta", n: number) => (host: GwenEngineBase) => {
  host.provide(key, { n });
};

describe("service change hooks", () => {
  it("unuse fires service:removed before teardown", async () => {
    const engine = await open();
    const value = { n: 4 };
    const log: string[] = [];
    let during: unknown;
    let removedValue: unknown;
    let removedReason = "";
    engine.hooks.hook("service:removed", (event) => {
      log.push("removed");
      during = engine.tryInject("p72:alpha");
      removedValue = event.value;
      removedReason = event.reason;
    });
    await install(
      engine,
      "owner",
      (host) => host.provide("p72:alpha", value),
      undefined,
      () => {
        log.push("teardown");
      },
    );
    await engine.unuse("owner");
    expect(log).toEqual(["removed", "teardown"]);
    expect(during).toBeUndefined();
    expect(removedValue).toBe(value);
    expect(removedReason).toBe("unuse");
  });
  it("stop removes the later service before the earlier one with reason stop", async () => {
    const engine = await open();
    const log: { key: string; reason: string }[] = [];
    engine.hooks.hook("service:removed", (event) => {
      log.push({ key: String(event.key), reason: event.reason });
    });
    await install(engine, "first", give("p72:alpha", 1));
    await install(engine, "second", give("p72:beta", 2));
    await engine.stop();
    expect(log).toEqual([
      { key: "p72:beta", reason: "stop" },
      { key: "p72:alpha", reason: "stop" },
    ]);
  });
  it("overwrite is removed then provided and the same reference adds nothing", async () => {
    const engine = await open();
    const first = { n: 1 };
    const second = { n: 2 };
    const log: { hook: string; reason: string; value: unknown; owner: string | undefined }[] = [];
    const push =
      (hook: string) => (event: { reason: string; value: unknown; owner: string | undefined }) =>
        log.push({ hook, reason: event.reason, value: event.value, owner: event.owner });
    engine.hooks.hook("service:removed", push("removed"));
    engine.hooks.hook("service:provided", push("provided"));
    engine.provide("p72:alpha", first);
    engine.provide("p72:alpha", second);
    engine.provide("p72:alpha", second);
    expect(log).toEqual([
      { hook: "provided", reason: "install", value: first, owner: undefined },
      { hook: "removed", reason: "overwrite", value: first, owner: undefined },
      { hook: "provided", reason: "overwrite", value: second, owner: undefined },
    ]);
    log.length = 0;
    await install(engine, "p1", give("p72:beta", 1));
    log.length = 0;
    await install(engine, "p2", give("p72:beta", 2));
    expect(log).toEqual([
      { hook: "removed", reason: "overwrite", value: { n: 1 }, owner: "p1" },
      { hook: "provided", reason: "overwrite", value: { n: 2 }, owner: "p2" },
    ]);
  });
  it("provide logger emits nothing and provide p72:alpha emits provided", async () => {
    const engine = await open();
    const other = await open();
    const marker = { n: 1 };
    const keys: string[] = [];
    engine.hooks.hook("service:provided", (event) => keys.push(String(event.key)));
    engine.hooks.hook("service:removed", (event) => keys.push(`removed:${String(event.key)}`));
    engine.provide("wasm:bridge", other.inject("wasm:bridge"));
    engine.provide("logger", other.logger);
    engine.provide("errors", other.errors);
    engine.provide("memory", other.inject("memory"));
    engine.provide("p72:alpha", marker);
    expect(keys).toEqual(["p72:alpha"]);
    expect(engine.tryInject("p72:alpha")).toBe(marker);
  });
  it("a throwing or rejecting service listener is isolated and reported once", async () => {
    const engine = await open();
    const bus: GwenErrorPayload[] = [];
    let second = 0;
    engine.errors.on((event) => bus.push(event));
    engine.hooks.hook("service:provided", () => {
      throw new Error("first-listener");
    });
    engine.hooks.hook("service:provided", () => (second += 1));
    await install(engine, "src", give("p72:alpha", 1));
    await engine.unuse("src");
    expect(second).toBe(1);
    expect(bus).toHaveLength(1);
    expect(bus[0]).toMatchObject({
      code: "CORE:PLUGIN_RUNTIME_ERROR",
      context: { hook: "service:provided", key: "p72:alpha" },
    });
    expect(bus[0]?.target).toBeUndefined();
    const rejecting = await open();
    let rejected = 0;
    rejecting.errors.on((event) => {
      if (event.code === "CORE:PLUGIN_RUNTIME_ERROR") rejected += 1;
    });
    rejecting.hooks.hook("service:provided", () => Promise.reject(new Error("later")));
    await install(rejecting, "async-listener", give("p72:beta", 1));
    if (rejected === 0) await Promise.resolve();
    expect(rejected).toBe(1);
  });
  it("0, 1, and 100 service listeners and engine B stays at 0", async () => {
    for (const count of [0, 1, 100]) {
      const engine = await open();
      let hits = 0;
      for (let i = 0; i < count; i += 1) engine.hooks.hook("service:provided", () => (hits += 1));
      engine.provide("p72:alpha", { n: count });
      expect(hits).toBe(count);
    }
    const left = await open();
    const right = await open();
    let leftHits = 0;
    let rightHits = 0;
    left.hooks.hook("service:provided", () => (leftHits += 1));
    right.hooks.hook("service:provided", () => (rightHits += 1));
    left.provide("p72:alpha", { n: 1 });
    expect(leftHits).toBe(1);
    expect(rightHits).toBe(0);
  });
  it("provided keys come before plugin:registered; a thrown setup emits nothing", async () => {
    const engine = await open();
    const first = { n: 1 };
    const log: string[] = [];
    engine.hooks.hook("service:provided", (event) => log.push(String(event.key)));
    engine.hooks.hook("service:removed", () => log.push("removed"));
    engine.hooks.hook("plugin:registered", () => log.push("plugin:registered"));
    await install(engine, "kept", (host) => host.provide("p72:alpha", first));
    log.length = 0;
    await expect(
      install(engine, "bad", (host) => {
        host.provide("p72:alpha", { n: 2 });
        throw new Error("setup-boom");
      }),
    ).rejects.toThrow(/setup failed/);
    expect(log).toEqual([]);
    expect(engine.tryInject("p72:alpha")).toBe(first);
    await engine.unuse("kept");
    expect(log).toEqual(["removed"]);
    expect(engine.tryInject("p72:alpha")).toBeUndefined();
    log.length = 0;
    await install(engine, "good", (host) => {
      host.provide("p72:alpha", { n: 1 });
      host.provide("p72:beta", { n: 2 });
    });
    expect(log).toEqual(["p72:alpha", "p72:beta", "plugin:registered"]);
  });
  it("unuse rejects CORE:PLUGIN_IN_USE and a later provide still emits", async () => {
    const engine = await open();
    const log: string[] = [];
    engine.hooks.hook("service:removed", () => log.push("removed"));
    engine.hooks.hook("service:provided", (event) => log.push(String(event.key)));
    await install(engine, "provider", give("p72:alpha", 1));
    await install(engine, "hard", () => {}, { services: ["p72:alpha"] });
    log.length = 0;
    await expect(engine.unuse("provider")).rejects.toMatchObject({ code: "CORE:PLUGIN_IN_USE" });
    expect(log).toEqual([]);
    expect(engine.tryInject("p72:alpha")).toEqual({ n: 1 });
    engine.provide("p72:beta", { n: 9 });
    expect(log).toEqual(["p72:beta"]);
  });
  it("a provide after setup is announced with install and removed on unuse", async () => {
    const engine = await open();
    const log: string[] = [];
    const note =
      (kind: string) => (event: { key: string; owner: string | undefined; reason: string }) =>
        log.push(`${kind}:${String(event.key)}:${event.owner ?? ""}:${event.reason}`);
    engine.hooks.hook("service:provided", note("provided"));
    engine.hooks.hook("service:removed", note("removed"));
    let host: GwenEngineBase | undefined;
    await install(engine, "late", async (scoped) => {
      host = scoped;
      await Promise.resolve();
    });
    const value = { n: 1 };
    host?.provide("p72:alpha", value);
    expect(log).toEqual(["provided:p72:alpha:late:install"]);
    expect(engine.tryInject("p72:alpha")).toBe(value);
    await engine.unuse("late");
    expect(engine.tryInject("p72:alpha")).toBeUndefined();
    expect(log).toEqual(["provided:p72:alpha:late:install", "removed:p72:alpha:late:unuse"]);
    await install(engine, "late", () => {});
    expect(log).toHaveLength(2);
  });
});
