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

describe("@gwenjs/renderer-core module", () => {
  it("the module claims no config key and installs no plugin", async () => {
    const loaded = await import("@gwenjs/renderer-core/module");
    expect(loaded.default.meta.configKey).toBeUndefined();
    const calls: string[] = [];
    await loaded.default.setup({}, recordingKit(calls));
    expect(calls).toEqual(["addAutoImports"]);
  });
});
