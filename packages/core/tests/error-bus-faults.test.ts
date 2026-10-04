import { describe, expect, it, vi } from "vitest";

import { CoreErrorCodes, createEngine } from "../src/index";

describe("plugin setup failure", () => {
  it("does not tear down a healthy sibling plugin", async () => {
    const engine = await createEngine();
    let updates = 0;
    const seen: Array<{ level: string; code: string }> = [];
    engine.errors.on((event) => {
      seen.push({ level: event.level, code: event.code });
    });

    await engine.use({
      name: "good",
      setup(host) {
        host.hooks.hook("engine:update", () => {
          updates += 1;
        });
      },
    });

    let caught = false;
    try {
      await engine.use({
        name: "bad",
        setup() {
          throw new Error("setup failed");
        },
      });
    } catch {
      caught = true;
    }

    expect(caught).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await engine.startExternal();
    await engine.advance(1 / 60);

    expect(updates).toBe(1);
    expect(seen).toEqual([{ level: "error", code: CoreErrorCodes.PLUGIN_SETUP_ERROR }]);

    await engine.advance(1 / 60);
    expect(updates).toBe(2);
    await engine.stop();
  });
});

describe("fixed-step loop", () => {
  it("keeps scheduling frames when an error handler throws", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => {
      clock += 20;
      return clock;
    });
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);

    const engine = await createEngine({ physicsHz: 60, maxDeltaSeconds: 1 });
    let frames = 0;
    engine.hooks.hook("engine:update", () => {
      frames += 1;
      throw new Error("frame");
    });
    engine.errors.on(() => {
      throw new Error("boom");
    });

    try {
      await engine.start();
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(frames).toBeGreaterThanOrEqual(3);
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      vi.restoreAllMocks();
      await engine.stop();
    }
  });
});
