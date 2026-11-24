import { defineConfig } from "vitest/config";

// A real production build: no source alias, no `__GWEN_DEV__` define. Vitest forces
// NODE_ENV=test, which leaks into `vite build()`, so the config sets it back.
export default defineConfig({
  test: {
    name: "bundle",
    environment: "node",
    include: ["tests/bundle-size.test.ts"],
    fileParallelism: false,
    env: { NODE_ENV: "production" },
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
