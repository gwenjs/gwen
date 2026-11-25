import { defineScene, useSystem } from "@gwenjs/core/scene";
import { MovementSystem } from "../systems/Movement";

export const GameScene = defineScene("Game", () => {
  useSystem(MovementSystem());
});
