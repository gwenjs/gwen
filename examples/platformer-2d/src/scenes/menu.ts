import { defineScene, useSystem } from "@gwenjs/core/scene";
import { MenuInputSystem } from "../systems/MenuInput";

export const menu = defineScene("menu", () => {
  useSystem(MenuInputSystem());
});
