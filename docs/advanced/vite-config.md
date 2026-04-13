---
title: Extending Vite
description: How to extend GWEN's Vite configuration without a vite.config.ts file.
---

# Extending Vite

GWEN manages your Vite configuration internally via `@gwenjs/vite`. You don't need a `vite.config.ts` file. Instead, extend Vite through `gwen.config.ts`.

## Global CSS

Use the `globalCss` field to inject CSS files into every page. Paths are **relative to the project root** (where `gwen.config.ts` lives):

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  globalCss: ['./src/styles/reset.css', './src/styles/global.css'],
})
```

These files are injected as static `import` statements in the virtual entry module, so Vite processes them through its normal CSS pipeline (including PostCSS, CSS Modules, etc.).

## From a Module

If you're authoring a [GWEN module](/kit/custom-module), use `gwen.extendViteConfig()` and `gwen.addVitePlugin()`:

```typescript
import { defineGwenModule } from '@gwenjs/kit/module'

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
