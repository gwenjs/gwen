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

describe("@gwenjs/physics2d module", () => {
  it("the module setup registers the plugin, auto-imports and vite plugin only", async () => {
    const calls: string[] = [];
    const loaded = await import("@gwenjs/physics2d/module");
    await loaded.default.setup({}, recordingKit(calls));
    expect(calls).toEqual(["addPlugin", "addVitePlugin", "addAutoImports"]);
  });
});
