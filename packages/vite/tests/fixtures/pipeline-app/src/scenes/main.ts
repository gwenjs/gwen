import { defineScene } from "@gwenjs/core/scene";
import { Score } from "../systems/score";

export const Main = defineScene("main", () => {
  void Score;
});
