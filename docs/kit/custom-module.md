---
title: Writing a Custom Module
description: Coming soon.
---

---
title: Writing a Custom Module
description: Learn how to create and use GWEN modules for build-time configuration.
---

# Writing a Custom Module

A **module** is a build-time extension defined using `defineGwenModule()` from `@gwenjs/kit`. While plugins handle runtime behavior, modules configure your GWEN project during the build process (`gwen dev`, `gwen build`, `gwen prepare`).

## The Basics

### Minimal Module

The simplest module just provides metadata:

```ts
import { defineGwenModule } from '@gwenjs/kit'

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
import { defineGwenModule, definePlugin } from '@gwenjs/kit'

const MyPlugin = definePlugin(() => ({
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
    // Export the plugin to be registered at runtime
    gwen.addPlugin(MyPlugin())
  },
})
```

In `main.ts`, use the plugin:

```ts
import { createEngine } from '@gwenjs/core'
import { MyPlugin } from '@my-scope/my-module'

const engine = await createEngine()
await engine.use(MyPlugin())
await engine.start()
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
import MyModule from '@my-scope/my-module'

export default defineConfig({
  modules: [MyModule],
  myModule: {
    debug: true,
    apiUrl: 'https://dev.api.example.com',
  },
})
```

Then in `main.ts`, register the plugin at runtime:

```ts
import { createEngine } from '@gwenjs/core'
import { MyPlugin } from '@my-scope/my-module'

const engine = await createEngine()
await engine.use(MyPlugin(/* options */))
await engine.start()
```

## Build-Time API (GwenKit)

The `gwen` parameter passed to `setup()` is the build-time API. Use it to configure plugins, auto-imports, Vite extensions, and type templates.

### Adding Plugins

Register runtime plugins to be loaded:

```ts
gwen.addPlugin(MyPlugin())
```

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
export const MySystem = defineSystem(() => {
  const service = useMyService()
  return (ctx) => { /* ... */ }
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

### Type Templates

Generate TypeScript declaration files for IDE auto-complete and type checking:

```ts
gwen.addTypeTemplate({
  filename: 'types/my-service.d.ts',
  getContents() {
    return `declare module '@gwenjs/core' {
      interface GwenProvides {
        myService: MyServiceAPI
      }
    }`
  },
})
```

### Module Augmentation

Add TypeScript declarations inline without creating a separate file:

```ts
gwen.addModuleAugment(`
  declare module '@gwenjs/core' {
    interface GwenProvides {
      myService: { greet(): string }
    }
  }
`)
```

## Real-World Example: Score Module

Here's a complete module that provides a score tracking system:

```ts
import { defineGwenModule, definePlugin } from '@gwenjs/kit'

interface ScoreModuleOptions {
  initialScore?: number
  maxScore?: number
}

// Runtime plugin
const ScorePlugin = definePlugin<ScoreModuleOptions>((opts = {}) => ({
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
    gwen.addPlugin(ScorePlugin(options))

    gwen.addAutoImports([
      { name: 'useScore', from: '@my-scope/score' },
    ])

    gwen.addModuleAugment(`
      declare module '@gwenjs/core' {
        interface GwenProvides {
          score: {
            get(): number
            add(amount: number): void
            set(value: number): void
            reset(): void
          }
        }
      }
    `)
  },
})
```

Use the score system in a game system:

```ts
import { defineSystem, useEngine } from '@gwenjs/core'

export const ScoreDisplaySystem = defineSystem(() => {
  const { get } = useEngine()
  const scoreService = get('score')

  return (ctx) => {
    const currentScore = scoreService.get()
    // Render score on screen
  }
})

// Or use auto-import
export const RewardSystem = defineSystem(() => {
  const score = useScore()

  return (ctx) => {
    if (playerCollectedCoin) {
      score.add(10)
    }
  }
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
import ScoreModule from '@my-scope/score'

export default defineConfig({
  modules: [ScoreModule],
  score: {
    initialScore: 0,
    maxScore: 9999,
  },
})
```

## API Summary

### defineGwenModule

Create a build-time module:

```ts
export default defineGwenModule<Options>({
  meta: {
    name: string
    configKey?: string
    version?: string
  }
  defaults?: DeepPartial<Options>
  setup(options: Options, gwen: GwenKit): void | Promise<void>
})
```

### GwenKit Methods

| Method | Purpose |
|--------|---------|
| `addPlugin(plugin)` | Register a runtime plugin |
| `addAutoImports(imports)` | Declare auto-imported utilities |
| `addVitePlugin(plugin)` | Add a Vite plugin to the build |
| `extendViteConfig(extender)` | Extend Vite configuration |
| `addTypeTemplate(template)` | Generate `.d.ts` files |
| `addModuleAugment(snippet)` | Add TypeScript declarations inline |
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

### GwenTypeTemplate

```ts
interface GwenTypeTemplate {
  filename: string      // Path inside `.gwen/`, e.g. 'types/my-service.d.ts'
  getContents(): string // Content factory called during `gwen prepare`
}
```
