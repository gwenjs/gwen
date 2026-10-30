---
title: Writing a Custom Module
description: Learn how to create and use GWEN modules for build-time configuration.
---

# Writing a Custom Module

A **module** is a build-time extension defined using `defineGwenModule()` from `@gwenjs/kit/module`. While plugins handle runtime behavior, modules configure your GWEN project during the build process (`gwen dev`, `gwen build`, `gwen prepare`).

## The Basics

### Minimal Module

The simplest module just provides metadata:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: {
    name: '@my-scope/my-module',
    configKey: 'myModule',
    version: '1.0.0',
  },
  setup(options, gwen) {
    // Module setup runs during build
    console.log('Building with options:', options)
  },
})
```

### Module with Plugin Registration

Most modules register one or more runtime plugins:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

export const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    engine.provide('myService', {
      greet: () => 'Hello from plugin!',
    })
  },
}))

export default defineGwenModule({
  meta: { name: '@my-scope/my-module', configKey: 'myModule' },
  setup(options, gwen) {
    gwen.addPlugin({ src: "@my-scope/my-module", export: "MyPlugin" })
  },
})
```

### Module with Options

Modules can accept typed options through the config:

```ts
interface MyModuleOptions {
  debug?: boolean
  apiUrl?: string
}

export default defineGwenModule<MyModuleOptions>({
  meta: {
    name: '@my-scope/my-module',
    configKey: 'myModule',
  },
  defaults: {
    debug: false,
    apiUrl: 'https://api.example.com',
  },
  setup(options, gwen) {
    console.log(`Debug mode: ${options.debug}`)
    console.log(`API URL: ${options.apiUrl}`)
  },
})
```

Register in `gwen.config.ts`:

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/my-module'],
  myModule: { debug: true, apiUrl: 'https://dev.api.example.com' },
})
```

## Local Module (Auto-Discovery)

For project-specific modules, drop a file in `src/modules/`. GWEN discovers all `.ts` files there (and `*/index.ts` one level deep) and loads them automatically — no `gwen.config.ts` entry required.

### Minimal Local Module

```ts
// src/modules/score.ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

export const ScorePlugin = definePlugin<{ maxScore?: number }>((opts = {}) => ({
  name: 'score',
  setup(engine) {
    let score = 0
    engine.provide('score', {
      get: () => score,
      add: (n: number) => { score = Math.min(score + n, opts.maxScore ?? 999) },
      reset: () => { score = 0 },
    })
  },
}))

export default defineGwenModule({
  meta: { configKey: 'score' }, // name inferred → 'local:score'
  defaults: { maxScore: 999 },
  setup(options, gwen) {
    gwen.addPlugin({ src: "./src/modules/score", export: "ScorePlugin", options })
  },
})
```

Drop this file and the module is active. No `gwen.config.ts` change needed.

### Name Inference

`meta.name` is optional for local modules. The name is inferred from the filename:

| File | Inferred name |
|---|---|
| `src/modules/score.ts` | `local:score` |
| `src/modules/score/index.ts` | `local:score` |
| explicit `meta: { name: 'my-score' }` | `my-score` (declared value wins) |

### Receiving options from `gwen.config.ts`

Set `meta.configKey` to receive options from the matching top-level key. Augment `GwenModuleOptions` in the same file for TypeScript auto-complete:

```ts
// src/modules/score.ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

interface ScoreOptions {
  initialScore?: number
  maxScore?: number
}

declare module '@gwenjs/schema' {
  interface GwenModuleOptions {
    score?: ScoreOptions
  }
}

export const ScorePlugin = definePlugin<ScoreOptions>((opts = {}) => ({
  name: 'score',
  setup(engine) {
    let score = opts.initialScore ?? 0
    engine.provide('score', {
      get: () => score,
      add: (n: number) => { score = Math.min(score + n, opts.maxScore ?? 999) },
      reset: () => { score = opts.initialScore ?? 0 },
    })
  },
}))

export default defineGwenModule<ScoreOptions>({
  meta: { configKey: 'score' },
  defaults: { initialScore: 0, maxScore: 999 },
  setup(options, gwen) {
    gwen.addPlugin({ src: "./src/modules/score", export: "ScorePlugin", options })
  },
})
```

Local modules are auto-discovered — no `modules:` entry is needed. Only the options key appears in `gwen.config.ts`:

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  score: { initialScore: 0, maxScore: 9999 },
})
```

::: tip No `@ts-expect-error` for local modules
Augment `@gwenjs/schema`, not `@gwenjs/app`. Add `@gwenjs/schema` to your project's own dependencies so that it resolves from your project; the `declare module "@gwenjs/schema"` augmentation then works without any suppression comment.
:::

`defaults` is merged under the section from `gwen.config.ts`. `validate?` reads that merged section and returns `GwenConfigIssue[]`. Each issue `path` is relative to the section. An empty list accepts it (`packages/schema/src/module.ts:293-300`).

### Subdirectory Support

```
src/modules/
├── score.ts              # → local:score
└── hud/
    └── index.ts          # → local:hud
```

::: warning One level only
`src/modules/hud/index.ts` ✅ — `src/modules/ui/hud/index.ts` ❌. Only one level of nesting is supported.
:::

### Hot Reload in Dev

Adding or removing a file in `src/modules/` triggers a full page reload. Editing an existing file uses normal Vite HMR.

## Build-Time API (GwenKit)

The `gwen` parameter passed to `setup()` is the build-time API. Use it to configure plugins, auto-imports, and Vite extensions.

### Adding Plugins

Register runtime plugins to be loaded:

```ts
gwen.addPlugin({ src: "@my-scope/my-module", export: "MyPlugin" })
```

`addPlugin` takes declarations only. `options` must be JSON-serializable. An instance, a factory, or options that are not JSON-serializable throw `APP:PLUGIN_NOT_DECLARATIVE`. Migrate with `kit.addPlugin({ src: "<pkg>", export: "<Factory>", options })`.

### Auto-Imports

Register composables and utilities that auto-import into game code without explicit `import` statements:

```ts
gwen.addAutoImports([
  { name: 'useMyService', from: '@my-scope/my-module' },
  { name: 'MyHelper', from: '@my-scope/my-module', as: 'Helper' },
])
```

In game code, `useMyService` is available without an import:

```ts
// No import needed!
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const MySystem = defineSystem(function MySystem() {
  const service = useMyService()

  onUpdate(() => { /* ... */ })
})
```

### Vite Extensions

Extend the Vite build configuration:

```ts
gwen.extendViteConfig((config) => ({
  resolve: {
    alias: {
      '~assets': '/src/assets',
    },
  },
}))
```

Add a Vite plugin:

```ts
gwen.addVitePlugin({
  name: 'my-vite-plugin',
  transform(code) {
    return code.replace(/MY_CONSTANT/g, '"replaced"')
  },
})
```

Services and hooks are typed by static declaration merging in the package source (as `packages/physics2d/src/augment.ts` does), not generated by the module.

## Real-World Example: Score Module

Here's a complete module that provides a score tracking system:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    score: {
      get(): number
      add(amount: number): void
      set(value: number): void
      reset(): void
    }
  }
}

interface ScoreModuleOptions {
  initialScore?: number
  maxScore?: number
}

// Runtime plugin
export const ScorePlugin = definePlugin<ScoreModuleOptions>((opts = {}) => ({
  name: 'score',
  setup(engine) {
    let score = opts.initialScore ?? 0
    const maxScore = opts.maxScore ?? 999999

    engine.provide('score', {
      get: () => score,
      add: (amount: number) => {
        score = Math.min(score + amount, maxScore)
      },
      set: (value: number) => {
        score = Math.max(0, Math.min(value, maxScore))
      },
      reset: () => {
        score = opts.initialScore ?? 0
      },
    })
  },
}))

// Build-time module
export default defineGwenModule<ScoreModuleOptions>({
  meta: {
    name: '@my-scope/score',
    configKey: 'score',
  },
  defaults: {
    initialScore: 0,
    maxScore: 999999,
  },
  setup(options, gwen) {
    gwen.addPlugin({ src: "@my-scope/score", export: "ScorePlugin", options })

    gwen.addAutoImports([
      { name: 'useScore', from: '@my-scope/score' },
    ])
  },
})
```

Use the score system in a game system:

```ts
import { defineSystem, useService, onUpdate } from '@gwenjs/core/system'

export const ScoreDisplaySystem = defineSystem(function ScoreDisplaySystem() {
  const scoreService = useService('score')

  onUpdate(() => {
    const currentScore = scoreService.get()
    // Render score on screen
  })
})

// Or use auto-import
export const RewardSystem = defineSystem(function RewardSystem() {
  const score = useScore()

  onUpdate(() => {
    if (playerCollectedCoin) {
      score.add(10)
    }
  })
})
```

## Build Hooks

Modules can subscribe to build-time events:

```ts
gwen.hook('build:before', () => {
  console.log('Build starting...')
})

gwen.hook('module:before', (mod) => {
  console.log(`Setting up module: ${mod.meta.name}`)
})

gwen.hook('module:done', (mod) => {
  console.log(`Finished module: ${mod.meta.name}`)
})

gwen.hook('build:done', () => {
  console.log('Build complete!')
})

gwen.hook('vite:extendConfig', (config) => {
  console.log('Vite config was extended')
})
```

## Module in Project

Register the module in `gwen.config.ts`:

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/score'],
  score: { initialScore: 0, maxScore: 9999 },
})
```

## API Summary

### defineGwenModule

Create a build-time module:

```ts
export default defineGwenModule<Options>({
  meta: {
    name?: string     // optional for local modules — inferred from filename
    configKey?: string
    version?: string
  }
  defaults?: DeepPartial<Options>
  validate?(options: Options): readonly GwenConfigIssue[]
  setup(options: Options, gwen: GwenKit): void | Promise<void>
})
```

### GwenKit Methods

| Method | Purpose |
|--------|---------|
| `addPlugin(declaration)` | Declare a runtime plugin: { src, export?, options? } |
| `addAutoImports(imports)` | Declare auto-imported utilities |
| `addVitePlugin(plugin)` | Add a Vite plugin to the build |
| `extendViteConfig(extender)` | Extend Vite configuration |
| `hook(event, fn)` | Subscribe to build-time events |
| `options` (property) | Access resolved config options |

### AutoImport

```ts
interface AutoImport {
  name: string          // Export name from the module
  from: string          // NPM package or path
  as?: string           // Override name in auto-import
}
```
