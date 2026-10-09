import { describe, expect, it } from "vitest";

import { WasmBridgeImpl } from "../../src/engine/wasm-bridge.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const REMOVED_METHODS = [
  "tick",
  "frame_count",
  "delta_time",
  "total_time",
  "should_sleep",
  "sleep_time_ms",
  "reset_frame",
] as const;

function methodNames(engine: object): string[] {
  const proto = Object.getPrototypeOf(engine);
  return Object.getOwnPropertyNames(proto);
}

describe("gwen-core wasm binary", () => {
  it("the core binary has no tick or GameLoop reader", async () => {
    const handles: RealEngineHandle[] = [];
    try {
      handles.push(await createRealEngine({ variant: "light", maxEntities: 4 }));
      handles.push(await createRealEngine({ variant: "light", maxEntities: 4 }));

      for (const handle of handles) {
        const names = methodNames(handle.bridge.engine());
        const present = REMOVED_METHODS.filter((name) => names.includes(name));
        expect(present).toEqual([]);
      }

      const bridge = new WasmBridgeImpl();
      expect("tick" in bridge).toBe(false);
    } finally {
      for (const handle of handles) {
        await handle.dispose();
      }
    }
  });
});
