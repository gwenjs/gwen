import type { GwenEngine } from "@gwenjs/core";
import { useWasmModule } from "@gwenjs/core/system";

export function useNav(engine: GwenEngine): number {
  engine.getWasmModule("nav");
  return useWasmModule("nav").exports.find();
}
