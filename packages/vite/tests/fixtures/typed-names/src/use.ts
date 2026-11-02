import { defineConfig } from "@gwenjs/app";
import { useHook } from "@gwenjs/core";
import { defineScene } from "@gwenjs/core/scene";
import { useService } from "@gwenjs/core/system";

export function useTypedNames(): void {
  useService("physics2d");
  useHook("physics:collision", () => {});
  useHook("nav:toGame", () => {});
  defineScene("game", () => {});
  defineConfig({
    modules: ["@gwenjs/physics2d"],
    mainScene: "game",
  });

  // @ts-expect-error mainScene typo is not a discovered scene
  defineConfig({ mainScene: "Mian" });

  // @ts-expect-error scene name is not in src/scenes
  defineScene("boss", () => {});

  // @ts-expect-error service key is not provided
  useService("audoi");

  // @ts-expect-error hook name is not declared
  useHook("nav:toGmae", () => {});
}
