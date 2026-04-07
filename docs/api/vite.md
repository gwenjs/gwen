---
title: "@gwenjs/vite"
description: "API reference for @gwenjs/vite — Vite plugins for GWEN projects."
---

# @gwenjs/vite

`pnpm add -D @gwenjs/vite`

Vite integration for GWEN. Provides the composite main plugin, an opt-in ECS optimizer, and build-time plugins for 2D/3D physics.

---

## `gwenVitePlugin(options?)`

The main entry point. A composite Vite plugin that wires up WASM bundling, actor/scene hot-reload, auto-imports, TypeScript declarations, layout support, tween helpers, and the optional ECS optimizer — all from a single registration.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin({
      wasm: { variant: 'auto', hmr: true },
      dts: true,
      actors: { dir: 'src/actors', hmr: true },
      optimizer: {
        componentsDir: 'src',
        tier: 'core',
        debug: false,
      },
    }),
  ],
})
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `wasm.variant` | `'debug' \| 'release' \| 'auto'` | `'auto'` | WASM build variant to load. `'auto'` picks `release` in production and `debug` in dev. |
| `wasm.wasmPath` | `string` | — | Override the resolved WASM file path. |
| `wasm.hmr` | `boolean` | `true` | Enable WASM hot-module replacement in dev. |
| `autoImports` | `AutoImport[]` | `[]` | Additional auto-import entries injected into the virtual module. |
| `typeTemplates` | `GwenTypeTemplate[]` | `[]` | Additional `.d.ts` template entries. |
| `gwenDir` | `string` | `'.gwen'` | Directory where generated files (dts, virtual modules) are written. |
| `dts` | `boolean` | `true` | Emit a `gwen.d.ts` type declaration file. |
| `actors.dir` | `string` | `'src/actors'` | Root directory scanned for actor files. |
| `actors.hmr` | `boolean` | `true` | Enable HMR for actor modules. |
| `layout.include` | `string[]` | — | Glob patterns of layout files to include. |
| `layout.disableNameInjection` | `boolean` | `false` | Skip injecting the layout name into each layout definition. |
| `sceneRouter` | `GwenSceneRouterOptions` | — | Options forwarded to the scene-router transform. |
| `tween` | `GwenTweenOptions` | — | Options forwarded to the tween transform. |
| `optimizer` | `boolean \| GwenOptimizerUserOptions` | — | Enable the ECS bulk optimizer (see below). |

### The `optimizer` option

The `optimizer` key controls whether the ECS optimizer transform runs inside `gwenVitePlugin`.

- **Omitted or `false`** — detect-only mode. The optimizer scans your source and logs patterns that could be optimized, but makes no code changes. Useful for auditing.
- **`true`** — transform mode with defaults: `componentsDir: 'src'`, `tier: 'core'`, `debug: false`.
- **Object** — transform mode with explicit configuration.

```ts
// Detect only (default)
gwenVitePlugin()

// Transform with defaults
gwenVitePlugin({ optimizer: true })

// Transform with explicit config
gwenVitePlugin({
  optimizer: {
    componentsDir: 'src/ecs',
    tier: 'physics2d',
    debug: true,
  },
})
```

| Sub-option | Type | Default | Description |
|---|---|---|---|
| `componentsDir` | `string` | `'src'` | Directory scanned for `defineComponent` calls. |
| `tier` | `'core' \| 'physics2d' \| 'physics3d'` | `'core'` | Optimization tier. Use a physics tier if your components include physics data. |
| `debug` | `boolean` | `false` | Emit verbose optimizer logs. |

---

## `gwenOptimizerPlugin(options?)`

Standalone opt-in Vite plugin that rewrites hot ECS loops into bulk array operations. Useful when you want fine-grained control over optimizer configuration independently from the composite plugin.

### Modes

- **`'detect'`** — scans source for optimizable `for...of` loops over query results and logs them. No code is modified. Good for a first audit.
- **`'transform'`** — rewrites detected patterns into batched array reads/writes, which can yield significant throughput gains for large entity populations.

### Standalone usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin, gwenOptimizerPlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin(),
    gwenOptimizerPlugin({
      mode: 'transform',
      tier: 'physics2d',
      componentsDir: 'src',
      debug: true,
    }),
  ],
})
```

### Integrated usage

Pass the `optimizer` key directly to `gwenVitePlugin` — no need to add `gwenOptimizerPlugin` separately:

```ts
gwenVitePlugin({ optimizer: { tier: 'physics2d', debug: true } })
```

:::tip
Prefer the integrated form for most projects. Use the standalone plugin only when you need to position the optimizer at a specific point in the Vite plugin pipeline.
:::

### Options (`GwenOptimizerOptions`)

| Option | Type | Default | Description |
|---|---|---|---|
| `mode` | `'detect' \| 'transform'` | `'transform'` | Optimizer mode. |
| `tier` | `'core' \| 'physics2d' \| 'physics3d'` | `'core'` | Optimization tier matching the component types in use. |
| `componentsDir` | `string` | `'src'` | Directory scanned for component definitions. |
| `debug` | `boolean` | `false` | Emit verbose logs during the transform pass. |

---

## `physics2dVitePlugin(options?)`

Build-time Vite plugin for 2D physics support. It performs **layer inlining**: references to named layers such as `Layers.wall` are replaced with their numeric value (e.g. `4`) at build time using `MagicString`, preserving accurate source maps.

:::tip Auto-registered
When you use the `@gwenjs/physics2d` module in `gwen.config.ts`, this plugin is registered automatically. You do not need to add it manually in most cases.
:::

If a layer is defined via `defineLayers()` but never referenced anywhere in the transformed source, the plugin emits a Vite **build warning** so dead layer definitions do not go unnoticed.

### Module config (`vite` sub-key)

Options for this plugin can be passed through the module configuration in `gwen.config.ts`:

```ts
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics2d', {
      gravity: -9.81,
      vite: {
        debug: true,  // passed to physics2dVitePlugin
      },
    }],
  ],
})
```

### Manual usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'
import { physics2dVitePlugin } from '@gwenjs/physics2d'

export default defineConfig({
  plugins: [
    gwenVitePlugin(),
    physics2dVitePlugin({ debug: false }),
  ],
})
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Log each layer substitution to the console. |

---

## `physics3dVitePlugin(options?)`

Build-time Vite plugin for 3D physics support. Provides two features:

1. **Layer inlining** — same as `physics2dVitePlugin`, replaces named layer references with their numeric values at build time.
2. **BVH pre-baking** — when `bvhPrebake: true`, detects `useMeshCollider('./file.glb')` call patterns and pre-compiles the BVH acceleration structure at build time. The string argument is replaced with `{ __bvhUrl: 'bvh-<hash>.bin' }`, so the heavy BVH computation is done once during the build rather than at runtime.

:::tip Auto-registered
When you use the `@gwenjs/physics3d` module in `gwen.config.ts`, this plugin is registered automatically. You do not need to add it manually in most cases.
:::

### Module config (`vite` sub-key)

```ts
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics3d', {
      gravity: { y: -9.81 },
      vite: {
        bvhPrebake: true,
        debug: false,  // passed to physics3dVitePlugin
      },
    }],
  ],
})
```

### Manual usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'
import { physics3dVitePlugin } from '@gwenjs/physics3d'

export default defineConfig({
  plugins: [
    gwenVitePlugin(),
    physics3dVitePlugin({ bvhPrebake: true, debug: false }),
  ],
})
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Log each layer substitution and BVH prebake operation. |
| `bvhPrebake` | `boolean` | `false` | Pre-compile BVH structures for mesh colliders at build time. |

:::warning Deprecated
`createGwenPhysics3DPlugin()` is deprecated. Replace all usages with `physics3dVitePlugin()`.
:::

---

## Type Definitions

### `GwenViteOptions`

```ts
interface GwenViteOptions {
  wasm?: {
    variant?: 'debug' | 'release' | 'auto'
    wasmPath?: string
    hmr?: boolean
  }
  autoImports?: AutoImport[]
  typeTemplates?: GwenTypeTemplate[]
  gwenDir?: string
  dts?: boolean
  actors?: {
    dir?: string
    hmr?: boolean
  }
  layout?: {
    include?: string[]
    disableNameInjection?: boolean
  }
  sceneRouter?: GwenSceneRouterOptions
  tween?: GwenTweenOptions
  optimizer?: boolean | {
    componentsDir?: string
    tier?: 'core' | 'physics2d' | 'physics3d'
    debug?: boolean
  }
}
```

### `GwenOptimizerOptions`

```ts
interface GwenOptimizerOptions {
  debug?: boolean
  mode?: 'detect' | 'transform'
  tier?: 'core' | 'physics2d' | 'physics3d'
  componentsDir?: string
}
```
