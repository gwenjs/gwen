/**
 * invokeEach reports a throwing registration on the engine error bus and continues.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEngine } from "@gwenjs/core/node";
import type { GwenEngine } from "@gwenjs/core";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { createExtensionRegistry } from "@gwenjs/kit/plugin";

const engines: GwenEngine[] = [];

async function open(): Promise<GwenEngine> {
  const engine = await createEngine();
  engines.push(engine);
  return engine;
}

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

describe("invokeEach", () => {
  it("invokeEach emits one error per throwing item with the owner as target, disposes it and runs the next", async () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const engine = await open();
    const events: GwenErrorPayload[] = [];
    const off = engine.errors.on((event) => {
      events.push(event);
    });
    try {
      const registry = createExtensionRegistry<number>({ name: "widgets" });
      const thrown = new Error("boom");
      const calls: string[] = [];
      registry.register("alpha", 1);
      registry.register("beta", 2);
      registry.invokeEach(engine.errors, "BASE:WIDGET", (item, owner) => {
        calls.push(`${owner}:${item}`);
        if (owner === "alpha") throw thrown;
      });
      expect(events).toEqual([
        {
          level: "error",
          code: "BASE:WIDGET",
          message:
            'Registration of "alpha" in extension registry "widgets" threw and was disposed.',
          error: thrown,
          source: "widgets",
          target: { kind: "plugin", id: "alpha", name: "alpha" },
        },
      ]);
      expect(events[0]?.error).toBe(thrown);
      expect(registry.size).toBe(1);
      expect(calls).toEqual(["alpha:1", "beta:2"]);
      calls.length = 0;
      events.length = 0;
      registry.invokeEach(engine.errors, "BASE:WIDGET", (item, owner) => {
        calls.push(`${owner}:${item}`);
      });
      expect(calls).toEqual(["beta:2"]);
      expect(events).toEqual([]);
    } finally {
      off();
    }
  });

  it("two throwing items emit two events, a pass that throws nothing emits zero", async () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const engine = await open();
    const events: GwenErrorPayload[] = [];
    const off = engine.errors.on((event) => {
      events.push(event);
    });
    try {
      const registry = createExtensionRegistry<string>({ name: "widgets" });
      const first = new Error("one");
      const second = new Error("two");
      const calls: string[] = [];
      registry.register("alpha", "a");
      registry.register("beta", "b");
      registry.register("gamma", "c");
      registry.invokeEach(engine.errors, "BASE:WIDGET", (_item, owner) => {
        calls.push(owner);
        if (owner === "alpha") throw first;
        if (owner === "gamma") throw second;
      });
      expect(events.map((event) => event.target?.id)).toEqual(["alpha", "gamma"]);
      expect(events).toHaveLength(2);
      expect(events[0]?.error).toBe(first);
      expect(events[1]?.error).toBe(second);
      expect(calls).toEqual(["alpha", "beta", "gamma"]);
      events.length = 0;
      calls.length = 0;
      registry.invokeEach(engine.errors, "BASE:WIDGET", (_item, owner) => {
        calls.push(owner);
      });
      expect(events).toEqual([]);
      expect(calls).toEqual(["beta"]);
    } finally {
      off();
    }
  });

  it("an error on engine A is not an event on engine B", async () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const engineA = await open();
    const engineB = await open();
    const eventsA: GwenErrorPayload[] = [];
    const eventsB: GwenErrorPayload[] = [];
    const offA = engineA.errors.on((event) => {
      eventsA.push(event);
    });
    const offB = engineB.errors.on((event) => {
      eventsB.push(event);
    });
    try {
      const registry = createExtensionRegistry<string>({ name: "widgets" });
      registry.register("alpha", "a");
      registry.invokeEach(engineA.errors, "BASE:WIDGET", () => {
        throw new Error("a");
      });
      expect(eventsA).toHaveLength(1);
      expect(eventsA[0]?.target).toEqual({ kind: "plugin", id: "alpha", name: "alpha" });
      expect(eventsB).toEqual([]);
    } finally {
      offA();
      offB();
    }
  });
});
