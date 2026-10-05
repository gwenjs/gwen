import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

const shared = {
  globals: true,
  environmentMatchGlobs: [
    ["tests/layer-manager.test.ts", "happy-dom"],
    ["tests/conformance-suite.test.ts", "happy-dom"],
  ] as Array<[string, string]>,
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
