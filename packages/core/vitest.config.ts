import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  // @ts-expect-error -- `benchmark` is a valid top-level Vitest config key but
  // some vitest/config typings omit it from the InlineConfig overload.
  benchmark: {
    include: ['benches/**/*.bench.ts'],
  },
});
