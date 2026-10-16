import type { GwenEngine } from "../../src/engine/engine-types";
import type { WasmEngine } from "../../src/engine/wasm-bridge-types";

/** Marks the per-engine bridge active so `start()` can schedule frames. */
export function activateTestWasm(engine: GwenEngine): void {
  let next = 0;
  engine.inject("wasm:bridge")._injectMock({
    register_component: (_laneKinds: Uint8Array) => next++,
  } as WasmEngine);
}
