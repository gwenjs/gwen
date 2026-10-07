import { describe, expect, it } from "vitest";
import { createEngine, CoreErrorCodes } from "@gwenjs/core";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { getOrCreateViewportManager } from "../src/get-or-create-viewport-manager.js";

// This package's test tsconfig loads no Node types. Declare the two Node globals this test uses.
declare const process: {
  on(event: "unhandledRejection", listener: (reason: unknown) => void): void;
  off(event: "unhandledRejection", listener: (reason: unknown) => void): void;
};
declare function setImmediate(callback: () => void): void;

describe("viewport hook rejection", () => {
  it("puts a rejected viewport:add handler on the error bus", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const engine = await createEngine();
    const events: GwenErrorPayload[] = [];
    engine.errors.on((event) => {
      events.push(event);
    });
    engine.hooks.hook("viewport:add", () => Promise.reject(new Error("viewport hook failed")));

    try {
      getOrCreateViewportManager(engine).set("main", { x: 0, y: 0, width: 1, height: 1 });
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      const hit = events.find((event) => event.message === "viewport hook failed");
      expect(hit).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "@gwenjs/renderer-core",
        context: { hook: "viewport:add" },
      });
      expect(hit?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await engine.stop();
    }
  });
});
