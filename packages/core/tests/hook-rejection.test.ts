import { describe, expect, it } from "vitest";

import { defineActor, definePrefab } from "../src/actor/index.js";
import { defineActorPool } from "../src/actor/runtime/pool/define-actor-pool.js";
import { createEngine } from "../src/engine/gwen-engine.js";
import { CoreErrorCodes } from "../src/index.js";
import type { GwenErrorPayload } from "@gwenjs/schema";
import { stubValue } from "./helpers/stub-component.js";

describe("rejected hook calls", () => {
  it("puts a rejected pool hook on the error bus and not on the process", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };

    const engine = await createEngine();
    try {
      process.on("unhandledRejection", onUnhandled);
      const events: GwenErrorPayload[] = [];
      engine.errors.on((event) => {
        events.push(event);
      });
      const actor = defineActor(
        definePrefab([{ def: stubValue("HookHp"), defaults: { value: 1 } }]),
        () => {},
      );
      const pool = defineActorPool(actor, { size: 2 });
      await engine.use(actor._plugin);
      await engine.use(pool._plugin);
      pool.hooks.hook("pool:acquire", () => Promise.reject(new Error("pool hook failed")));

      pool.acquire();
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });
      expect(unhandled).toEqual([]);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        message: "pool hook failed",
        source: `pool:${pool.actorName}`,
        context: { hook: "pool:acquire", frame: engine.frameCount },
      });
      // A rejected callHook does not say which listener failed: no target, no isolation.
      expect(events[0]?.target).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await engine.stop();
    }
  });
});
