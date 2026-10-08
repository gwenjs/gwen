import type { GwenEngine } from "../../src/engine/gwen-engine";
import type { WasmEngine } from "../../src/engine/wasm-bridge-types";

/** Marks the per-engine bridge active so `start()` can schedule frames. */
export function activateTestWasm(engine: GwenEngine): void {
  engine.inject("wasm:bridge")._injectMock({} as WasmEngine);
}
