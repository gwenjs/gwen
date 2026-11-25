import { definePlugin } from "@gwenjs/kit/plugin";

/** The smallest plugin: a name and an empty setup. */
export const SelftestPlugin = definePlugin(() => ({
  name: "@selftest/plugin",
  setup() {},
}));
