import { defineScene, onEnter } from "@gwenjs/core/scene";
import { Score } from "../systems/score";

export const Main = defineScene("main", () => {
  onEnter(async () => {
    await Promise.resolve();
  });
  void Score;
});
