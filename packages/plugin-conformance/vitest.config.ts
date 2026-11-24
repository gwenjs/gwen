import { defaultExclude, defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

const shared = {
  environment: "node" as const,
  // Tests pack the fixture and run publint and attw: same budget as SLOW_TEST_MS.
  testTimeout: 60_000,
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
        test: {
          name: "dev",
          ...shared,
        },
      },
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "false" },
        test: {
          name: "prod",
          ...shared,
          // Per-entity warning is a no-op when __GWEN_DEV__ is false
          // (packages/core/src/engine/engine-internals.ts:131).
          exclude: [...defaultExclude, "tests/runtime/**"],
        },
      },
    ],
  },
});
