import { defineConfig } from "@gwenjs/app";
import { useHook } from "@gwenjs/core";
import { defineScene } from "@gwenjs/core/scene";
import { useService, useWasmModule } from "@gwenjs/core/system";

export function useWrongNames(): void {
  defineConfig({ mainScene: "Mian" });
  defineScene("boss", () => {});
  useService("audoi");
  useHook("nav:toGmae", () => {});
  useWasmModule("nvv");
}
