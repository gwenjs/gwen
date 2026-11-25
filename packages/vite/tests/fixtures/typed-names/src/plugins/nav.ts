import type { GwenEngine } from "@gwenjs/core";
import type { NavExports } from "../nav-types";

export async function loadNav(engine: GwenEngine): Promise<void> {
  await engine.loadWasmModule<NavExports>({ name: "nav", url: "nav.wasm" });
}
