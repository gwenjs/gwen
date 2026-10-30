import { GwenError } from "@gwenjs/schema";
import { WasmBridgeImpl } from "../../../src/internal";
import { createEngine } from "../../../src/engine/engine-factory";

/**
 * Boot one engine through the real `WasmBridgeImpl.init` path, then report the outcome on
 * `document.body.dataset.result` as JSON. No inline script: the page runs under a strict CSP.
 *
 * Pass `jsUrl` to pin that glue file and `/wasm/light/gwen_core_bg.wasm`.
 * Omit it and both URLs stay unset.
 */
export async function boot(jsUrl?: string): Promise<void> {
  try {
    const bridge = new WasmBridgeImpl();
    const source = jsUrl === undefined ? {} : { jsUrl, wasmUrl: "/wasm/light/gwen_core_bg.wasm" };
    await bridge.init("light", {
      ...source,
      maxEntities: 16,
    });
    const engine = await createEngine({ _bridge: bridge });
    engine.createEntity();
    const entities = engine.getStats().entityCount;
    await engine.stop();
    document.body.dataset.result = JSON.stringify({ ok: true, entities });
  } catch (err: unknown) {
    const code = err instanceof GwenError ? err.code : undefined;
    const message = err instanceof Error ? err.message : String(err);
    document.body.dataset.result = JSON.stringify({ ok: false, code, message });
  }
}
