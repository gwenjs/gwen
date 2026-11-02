import { defineConfig } from "@gwenjs/app";
import { useHook } from "@gwenjs/core";
import { defineScene } from "@gwenjs/core/scene";
import { useService } from "@gwenjs/core/system";

export function useTypedNames(): void {
  useService("physics2d");
  useService("audio");
  useHook("physics:collision", () => {});
  useHook("nav:toGame", () => {});
  defineScene("game", () => {});
  defineConfig({
    modules: ["@gwenjs/physics2d"],
    mainScene: "game",
  });
}
