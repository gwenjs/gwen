import { defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

const shared = {
  globals: true,
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
        test: {
          name: "dev",
          ...shared,
          typecheck: {
            enabled: true,
            include: ["tests/types/**/*.test-d.ts"],
            tsconfig: "tsconfig.test.json",
          },
        },
      },
      {
        resolve: { alias },
        define: { __GWEN_DEV__: "false" },
        test: { name: "prod", ...shared },
      },
    ],
  },
});
