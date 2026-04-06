---
title: Extending Vite
description: How to extend GWEN's Vite configuration without a vite.config.ts file.
---

# Extending Vite

GWEN manages your Vite configuration internally via `@gwenjs/vite`. You don't need a `vite.config.ts` file. Instead, extend Vite through `gwen.config.ts`.

## Simple Overrides

Use the `vite` field for direct config merges:

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
    server: {
      port: 3000,
    },
  },
})
```

The `vite` object is merged with the internal GWEN config using `defu` (user values take precedence).

## Build Hooks

For more control, subscribe to the `vite:extendConfig` build hook:

```typescript
// gwen.config.ts
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = {
        ...config.resolve.alias,
        '~assets': './src/assets',
      }
    },
  },
})
```

Use `vite` for static configuration. Use `hooks['vite:extendConfig']` when you need conditional or programmatic config.

## From a Module

If you're authoring a [GWEN module](/kit/custom-module), use `gwen.extendViteConfig()` and `gwen.addVitePlugin()`:

```typescript
import { defineGwenModule } from '@gwenjs/kit'

export default defineGwenModule({
  meta: { name: '@my-scope/gwen-assets' },
  setup(options, gwen) {
    gwen.extendViteConfig(config => ({
      resolve: {
        alias: { '~assets': './src/assets' },
      },
    }))

    gwen.addVitePlugin(myVitePlugin())
  },
})
```

Plugins added via `gwen.addVitePlugin()` are inserted **before** the user's `vite.plugins` array.
