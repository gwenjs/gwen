/** Example module. It registers `tint:inline` and does not import `@gwenjs/vite`. */
import { defineGwenModule } from "@gwenjs/kit/module";
import { tintTransform } from "./transform.js";

/** `@example/tint` module. `setup` only calls `kit.addSourceTransform`. */
export const tintModule = defineGwenModule({
  meta: { name: "@example/tint" },
  setup(_options, kit) {
    kit.addSourceTransform(tintTransform);
  },
});

export default tintModule;
