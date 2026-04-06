# @gwenjs/app

GWEN application runtime. Loads the engine configuration, initializes WASM, resolves plugins, and manages the scene router lifecycle.

## What it does

`@gwenjs/app` is the entry point for a GWEN game. It:
1. Loads `gwen.config.ts` (or `.js`) via `c12`
2. Validates config against `@gwenjs/schema`
3. Initializes the WASM engine variant (light / physics2d / physics3d)
4. Resolves and registers all declared plugins
5. Starts the scene router

In most projects this is called automatically by the Vite plugin — you do not need to call it manually.

## Manual usage

```typescript
import { createApp } from '@gwenjs/app';

const app = await createApp({
  config: './gwen.config.ts',
  env: 'production',
});

await app.start();
```

## Configuration

See `@gwenjs/schema` for the full `GwenConfig` type and all available options.

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/schema';

export default defineConfig({
  engine: {
    maxEntities: 10_000,
    variant: 'physics3d',
  },
  plugins: [
    Physics3DPlugin({ gravity: { x: 0, y: -9.81, z: 0 } }),
    Canvas2DRendererPlugin(),
  ],
});
```

## Module system

GWEN modules (from `@gwenjs/kit`'s `defineGwenModule`) can be registered in the config and are resolved before the app starts:

```typescript
export default defineConfig({
  modules: [MyGameModule],
});
```

## Hooks

`@gwenjs/app` uses `hookable` to expose lifecycle hooks:

| Hook | Description |
|------|-------------|
| `app:before-init` | Before WASM initialization |
| `app:ready` | After all plugins are registered |
| `app:error` | Unhandled error during startup |

## See also

- `@gwenjs/schema` — Configuration schema
- `@gwenjs/kit` — Plugin authoring
- `@gwenjs/cli` — Project tooling (build, dev, scaffold)
