import { useActor } from "@gwenjs/core/actor";
import { defineScene, onEnter } from "@gwenjs/core/scene";
import { Ball } from "../actors/Ball";

export const WorldScene = defineScene("World", () => {
  const ball = useActor(Ball);
  onEnter(() => {
    ball.spawn();
  });
});
