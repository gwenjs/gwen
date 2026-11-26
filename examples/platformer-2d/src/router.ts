import { defineSceneRouter } from "@gwenjs/core/scene";
import { interpolation } from "./scenes/interpolation";
import { level } from "./scenes/level";
import { menu } from "./scenes/menu";

export const AppRouter = defineSceneRouter({
  initial: "menu",
  routes: {
    menu: { scene: menu, on: { START: "level", INTERPOLATION: "interpolation" } },
    level: { scene: level, on: {} },
    interpolation: { scene: interpolation, on: {} },
  },
});
