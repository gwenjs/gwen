import { describe, expect, it } from "vitest";
import type { GwenKit } from "@gwenjs/schema";

function isKit(value: object): value is GwenKit {
  return "options" in value;
}

function recordingKit(calls: string[]): GwenKit {
  const target = { options: {} };
  const proxy = new Proxy(target, {
    get(target, key) {
      if (typeof key !== "string") return undefined;
      if (key in target) return Reflect.get(target, key);
      return (..._args: readonly unknown[]) => {
        calls.push(key);
      };
    },
  });
  if (!isKit(proxy)) {
    throw new Error("recording kit is missing options");
  }
  return proxy;
}

describe("@gwenjs/physics3d module export", () => {
  it("D13 module export: import('@gwenjs/physics3d/module') resolves", async () => {
    const specifier = "@gwenjs/physics3d/module";
    const loaded: { default: { meta: { name: string } } } = await import(specifier);
    expect(loaded).toBeTruthy();
    expect(loaded.default.meta.name).toBe("@gwenjs/physics3d");
  });

  it("the module setup registers the plugin, auto-imports and vite plugin only", async () => {
    const calls: string[] = [];
    const loaded = await import("@gwenjs/physics3d/module");
    await loaded.default.setup({}, recordingKit(calls));
    expect(calls).toEqual(["addPlugin", "addAutoImports", "addVitePlugin"]);
  });
});
