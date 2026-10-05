import { defaultExclude, defineConfig } from "vitest/config";
import { gwenSourceAliases } from "../../vitest.aliases.ts";

const alias = gwenSourceAliases();

const shared = {
  globals: true,
  environment: "node" as const,
  // `exclude` replaces Vitest defaults. Keep node_modules, .git, and dist.
  // `bench/**` is relative to the package root, so `vitest run --dir bench` still matches.
  exclude: [...defaultExclude, "**/dist/**", "tests/integration-wasm/**", "bench/**"],
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
  // @ts-expect-error -- `benchmark` is a valid top-level Vitest config key but
  // some vitest/config typings omit it from the InlineConfig overload.
  benchmark: {
    include: ["bench/**/*.bench.ts"],
  },
});
