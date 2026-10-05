import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = [
  {
    find: "virtual:gwen/local-plugins",
    replacement: resolve(__dirname, "tests/__stubs__/virtual-local-plugins.ts"),
  },
  {
    find: "virtual:gwen/local-modules",
    replacement: resolve(__dirname, "tests/__stubs__/virtual-local-modules.ts"),
  },
  ...gwenSourceAliases(),
];

const shared = {
  environment: "node" as const,
};

export default defineConfig({
  resolve: {
    alias,
  },
  test: {
    projects: [
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "true" },
        test: { name: "dev", ...shared },
      },
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "false" },
        test: { name: "prod", ...shared },
      },
    ],
  },
});
