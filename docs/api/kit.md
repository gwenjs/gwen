---
title: "@gwenjs/kit"
description: "API reference for @gwenjs/kit."
---

# @gwenjs/kit API Reference

`pnpm add @gwenjs/kit`

## `@gwenjs/kit` — Shared types

Types shared between plugin and module authors.

**Exports:** `AutoImport`, `GwenTypeTemplate`, `DeepPartial`

**Usage:**
```ts
import type { AutoImport, GwenTypeTemplate, DeepPartial } from '@gwenjs/kit'
```

## `@gwenjs/kit/plugin`

Plugin authoring utilities and core type re-exports.

**Exports:** `definePlugin`, `satisfiesPluginContract`, `definePluginTypes`, `GwenPluginFactory` (type), plus core type re-exports: `GwenPlugin`, `GwenEngine`, `GwenProvides`, `GwenRuntimeHooks`, `EntityId`, etc.

**Usage:**
```ts
import { definePlugin, satisfiesPluginContract } from '@gwenjs/kit/plugin'
import type { GwenEngine, GwenPlugin } from '@gwenjs/kit/plugin'
```

### definePlugin(factory)

**Signature:**
```ts
function definePlugin<T = any>(
  factory: (opts?: T) => PluginDef
): GwenPluginFactory<T>
```

**Description.** Creates a reusable plugin factory. The factory function receives options and returns a plugin definition with a `name` and a `setup(engine)` function.

**Example:**
```ts
export const InputPlugin = definePlugin<{ deadzone?: number }>((opts = {}) => ({
  name: 'input',
  setup(engine) {
    const keys = new Set<string>()
    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })
    engine.provide('input', { isKeyDown: (k: string) => keys.has(k) })
  },
}))
```

## `@gwenjs/kit/module`

Build-time module authoring.

**Exports:** `defineGwenModule`, `GwenModule` (type), `GwenModuleDefinition` (type), `GwenKit` (type), `GwenBuildHooks` (type), `GwenBaseConfig` (type)

**Usage:**
```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import type { GwenKit, GwenModule } from '@gwenjs/kit/module'
```

### defineGwenModule(definition)

**Signature:**
```ts
function defineGwenModule<Options extends object = Record<string, unknown>>(
  definition: GwenModuleDefinition<Options>
): GwenModule<Options>
```

**Description.** Defines a GWEN module for build-time configuration. A module registers plugins, auto-imports, Vite extensions, and type templates. It is referenced by name in `gwen.config.ts`.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| `definition.meta.name` | `string` | Module identifier (e.g. `'@my-scope/input'`) |
| `definition.meta.configKey` | `string` | Key used in `gwen.config.ts` (optional) |
| `definition.defaults` | `DeepPartial<Options>` | Default option values (optional) |
| `definition.setup` | `(options, gwen) => void` | Build-time setup function |

**Example:**
```ts
export default defineGwenModule<{ volume?: number }>({
  meta: {
    name: '@my-scope/audio',
    configKey: 'audio',
  },
  defaults: { volume: 0.8 },
  setup(options, gwen) {
    gwen.addPlugin(AudioPlugin(options))
    gwen.addAutoImports([
      { name: 'useAudio', from: '@my-scope/audio' },
    ])
  },
})
```

### Types

#### GwenModuleDefinition

```ts
interface GwenModuleDefinition<Options extends object = Record<string, unknown>> {
  meta: {
    name: string
    configKey?: string
    version?: string
  }
  defaults?: DeepPartial<Options>
  setup(options: Options, gwen: GwenKit): void | Promise<void>
}
```

#### GwenKit

The build-time API passed to `setup()`:

| Method | Purpose |
|--------|---------|
| `addPlugin(plugin)` | Register a runtime plugin |
| `addAutoImports(imports)` | Declare auto-imported utilities |
| `addVitePlugin(plugin)` | Add a Vite plugin to the build |
| `extendViteConfig(fn)` | Extend Vite configuration |
| `addTypeTemplate(template)` | Generate `.d.ts` files |
| `addModuleAugment(snippet)` | Add TypeScript declarations inline |
| `hook(event, fn)` | Subscribe to a build-time event |
| `options` | Access resolved config options |

#### GwenBuildHooks

Available build-time hook events:

| Event | When |
|---|---|
| `'build:before'` | Before the build starts |
| `'build:done'` | After the build completes |
| `'module:before'` | Before a module's setup runs |
| `'module:done'` | After a module's setup completes |
| `'vite:extendConfig'` | When Vite config is being assembled |

#### AutoImport

```ts
interface AutoImport {
  name: string   // Export name from the source module
  from: string   // npm package or path
  as?: string    // Override the name used in auto-import
}
```

#### GwenTypeTemplate

```ts
interface GwenTypeTemplate {
  filename: string         // Path inside .gwen/, e.g. 'types/audio.d.ts'
  getContents(): string    // Returns the .d.ts content
}
```
