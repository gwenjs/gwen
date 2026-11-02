import { defineConfig } from "@gwenjs/app";
import { AudioPlugin } from "./src/plugins/audio";

// physics2d's service key and hooks are declaration-merged from the package.
// use.ts does not import the plugin.
import "@gwenjs/physics2d";

export default defineConfig({
  modules: ["@gwenjs/physics2d"],
  plugins: [AudioPlugin()],
});
