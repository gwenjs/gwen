import { describe, expect, it } from "vitest";
import type { GwenErrorBusBase, GwenErrorPayload } from "@gwenjs/schema";
import { createExtensionRegistry } from "@gwenjs/kit/plugin";

function recordingBus(): GwenErrorBusBase & { readonly events: GwenErrorPayload[] } {
  const events: GwenErrorPayload[] = [];
  return {
    events,
    emit(payload) {
      events.push(payload);
    },
    on() {
      return () => {};
    },
    onFatal() {
      return () => {};
    },
  };
}

describe("createExtensionRegistry", () => {
  it("register returns an idempotent disposer and size follows", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const registry = createExtensionRegistry<number>({ name: "widgets" });
    expect(registry.size).toBe(0);
    const disposeA = registry.register("a", 1);
    expect(registry.size).toBe(1);
    registry.register("b", 2);
    expect(registry.size).toBe(2);
    disposeA();
    disposeA();
    expect(registry.size).toBe(1);
    const seen: string[] = [];
    registry.forEach((_item, owner) => {
      seen.push(owner);
    });
    expect(seen).toEqual(["b"]);
  });

  it("forEach visits items in registration order with their owner", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const registry = createExtensionRegistry<number>({ name: "widgets" });
    registry.register("a", 1);
    registry.register("b", 2);
    registry.register("c", 3);
    const owners: string[] = [];
    registry.forEach((_item, owner) => {
      owners.push(owner);
    });
    expect(owners).toEqual(["a", "b", "c"]);
  });

  it("zero items: forEach and invokeEach call nothing", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const registry = createExtensionRegistry<string>({ name: "widgets" });
    let calls = 0;
    registry.forEach(() => {
      calls += 1;
    });
    const bus = recordingBus();
    registry.invokeEach(bus, "BASE:WIDGET", () => {
      calls += 1;
    });
    expect(calls).toBe(0);
    expect(bus.events).toEqual([]);
  });

  it("two registries are independent", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const alpha = createExtensionRegistry<string>({ name: "alpha" });
    const beta = createExtensionRegistry<string>({ name: "beta" });
    alpha.register("a", "a");
    const seen: string[] = [];
    beta.forEach((_item, owner) => {
      seen.push(owner);
    });
    expect(beta.size).toBe(0);
    expect(seen).toEqual([]);
  });

  it("a registration disposed during a pass is not visited and no other item is skipped or repeated", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const registry = createExtensionRegistry<string>({ name: "order" });
    registry.register("a", "a");
    const disposeB = registry.register("b", "b");
    registry.register("c", "c");
    const visited: string[] = [];
    registry.forEach((item) => {
      visited.push(item);
      if (item === "a") disposeB();
    });
    expect(visited).toEqual(["a", "c"]);

    const self = createExtensionRegistry<string>({ name: "self" });
    const disposeSelf = self.register("a", "a");
    self.register("b", "b");
    const seen: string[] = [];
    self.forEach((item) => {
      seen.push(item);
      if (item === "a") disposeSelf();
    });
    expect(seen).toEqual(["a", "b"]);
  });

  it("an item registered during a pass is visited from the next pass", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const registry = createExtensionRegistry<string>({ name: "later" });
    registry.register("a", "a");
    const pass1: string[] = [];
    registry.forEach((item) => {
      pass1.push(item);
      if (item === "a") registry.register("b", "b");
    });
    expect(pass1).toEqual(["a"]);
    const pass2: string[] = [];
    registry.forEach((item) => {
      pass2.push(item);
    });
    expect(pass2).toEqual(["a", "b"]);
  });

  it("createExtensionRegistry reads no ambient context", () => {
    expect(typeof createExtensionRegistry).toBe("function");
    const registry = createExtensionRegistry<string>({ name: "outside" });
    expect(registry.size).toBe(0);
  });
});
