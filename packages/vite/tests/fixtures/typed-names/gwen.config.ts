import { defineConfig } from "@gwenjs/app";
import { AudioPlugin } from "./src/plugins/audio";

export default defineConfig({
  modules: ["@gwenjs/physics2d"],
  plugins: [AudioPlugin()],
});
