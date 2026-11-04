/**
 * Duck-typed reads of a plugin or a component definition go through `get`, so a Proxy whose
 * `get` trap serves a key and that has no `has` trap is read like any other object.
 */
import { describe, expect, it } from "vitest";
import type { GwenPlugin } from "@gwenjs/schema";
import { isComponentDefinition } from "../../src/core/component-type-normalizer";
import { readMember } from "../../src/scene/runtime/read-member";
import { createSystemHandle } from "../../src/scene/runtime/system-handle";
import { _withSceneContext, useSystem } from "../../src/scene/runtime/scene-context";

/** Serves `served` through `get` only: `in` on the result is false for every served key. */
function servedByGet<T extends object>(target: T, served: Record<string, unknown>): T {
  return new Proxy(target, {
    get: (t, key, receiver) =>
      typeof key === "string" && key in served ? served[key] : Reflect.get(t, key, receiver),
  });
}

const plain: GwenPlugin = { name: "plain", setup() {} };

describe("duck-typed reads through a proxy that has no has trap", () => {
  it("isComponentDefinition accepts a proxy whose get trap serves a string name", () => {
    expect(isComponentDefinition(servedByGet({}, { name: "Served" }))).toBe(true);
    expect(isComponentDefinition(servedByGet({}, { name: 3 }))).toBe(false);
    expect(isComponentDefinition(null)).toBe(false);
  });

  it("a system handle reads _isIsolated and _pause from the proxy and calls them on it", () => {
    let paused = 0;
    let isolated = true;
    const plugin = servedByGet(plain, {
      _pause: () => {
        paused += 1;
      },
      _isIsolated: () => isolated,
    });
    const { handle } = createSystemHandle(plugin);

    expect(handle.isolated).toBe(true);
    expect(handle.active).toBe(false);
    handle.pause();
    expect(paused).toBe(1);
    isolated = false;
    expect(handle.isolated).toBe(false);
  });

  it("a plain plugin without the hooks is never isolated and pause does not throw", () => {
    const { handle } = createSystemHandle(plain);
    expect(handle.isolated).toBe(false);
    expect(handle.active).toBe(true);
    expect(() => handle.pause()).not.toThrow();
  });

  it("useSystem runs the _discover of a proxy that serves it through get", () => {
    let discovered = 0;
    const plugin = servedByGet(plain, {
      _discover: () => {
        discovered += 1;
      },
    });

    _withSceneContext(() => {
      useSystem(plugin);
    });

    expect(discovered).toBe(1);
  });

  it("a primitive plugin reads undefined for the hooks like a direct property read", () => {
    // The types reject a primitive plugin: `Reflect.apply` hands one to the public functions.
    const handleOf = (inner: unknown): ReturnType<typeof createSystemHandle> =>
      Reflect.apply(createSystemHandle, undefined, [inner]);
    const useAny = (inner: unknown): ReturnType<typeof useSystem> =>
      Reflect.apply(useSystem, undefined, [inner]);

    for (const primitive of [42, "text", true]) {
      const { handle } = handleOf(primitive);
      expect(handle.isolated).toBe(false);
      expect(handle.active).toBe(true);
      expect(() => handle.pause()).not.toThrow();
    }

    const ctx = _withSceneContext(() => {
      useAny(42);
    });
    expect(ctx.handles).toHaveLength(1);
    expect(ctx.systems).toHaveLength(1);
  });

  it("a null or undefined plugin throws a TypeError on the first hook read", () => {
    const handleOf = (inner: unknown): ReturnType<typeof createSystemHandle> =>
      Reflect.apply(createSystemHandle, undefined, [inner]);
    const useAny = (inner: unknown): ReturnType<typeof useSystem> =>
      Reflect.apply(useSystem, undefined, [inner]);

    expect(() => handleOf(null).handle.isolated).toThrow(TypeError);
    expect(() => _withSceneContext(() => void useAny(undefined))).toThrow(TypeError);
  });
});

describe("readMember", () => {
  it("throws the native TypeError of Reflect.get for null and for undefined", () => {
    expect(() => readMember(null, "_discover")).toThrow(TypeError);
    expect(() => readMember(undefined, "_discover")).toThrow(TypeError);
    expect(() => readMember(null, "_discover")).toThrow("Reflect.get called on non-object");
  });

  it("reads a key a proxy serves through get, from an object and from a function", () => {
    expect(readMember(servedByGet({}, { k: 1 }), "k")).toBe(1);
    expect(
      readMember(
        servedByGet(() => 0, { k: 2 }),
        "k",
      ),
    ).toBe(2);
  });

  it("reads a key of a primitive and undefined for a key it lacks", () => {
    expect(readMember("abc", "length")).toBe(3);
    expect(readMember(42, "_discover")).toBeUndefined();
  });
});
