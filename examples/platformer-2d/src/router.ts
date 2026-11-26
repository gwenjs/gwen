import { defineSceneRouter } from "@gwenjs/core/scene";
import { level } from "./scenes/level";
import { menu } from "./scenes/menu";

export const AppRouter = defineSceneRouter({
  initial: "menu",
  routes: {
    menu: { scene: menu, on: { START: "level" } },
    level: { scene: level, on: {} },
  },
});
