import { defineConfig } from "@gwenjs/app";

export default defineConfig({
  mainScene: "menu",
  modules: ["@gwenjs/physics2d"],
  physics2d: { gravity: { y: -9.81 } },
  engine: { maxEntities: 2000, targetFPS: 60, physicsHz: 60 },
});
