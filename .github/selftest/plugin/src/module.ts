import { defineGwenModule } from "@gwenjs/kit/module";

export default defineGwenModule({
  meta: { name: "@selftest/plugin" },
  setup(_options, kit) {
    kit.addPlugin({ src: "@selftest/plugin", export: "SelftestPlugin" });
  },
});
