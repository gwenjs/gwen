import { defineSceneRouter } from "@gwenjs/core/scene";
import { GameScene } from "./scenes/GameScene";

export const AppRouter = defineSceneRouter({
  initial: "game",
  routes: {
    game: { scene: GameScene, on: {} },
  },
});
