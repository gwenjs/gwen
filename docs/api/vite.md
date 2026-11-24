---
title: "@gwenjs/vite"
description: "API reference for @gwenjs/vite — Vite plugins for GWEN projects."
---

# @gwenjs/vite

`pnpm add -D @gwenjs/vite`

Vite integration for GWEN. Provides the composite main plugin and build-time plugins for 2D/3D physics.

---

## `gwenVitePlugin(options?)`

The main entry point. A composite Vite plugin that wires up actor/scene hot-reload, auto-imports, TypeScript declarations, layout support, and tween helpers — all from a single registration.

Names are injected by `gwen:transform-pipeline` in both `gwen()` and `gwenVitePlugin()`, matched by import binding. Layout and scene-router names are a statement guarded by `__GWEN_DEV__`, so production bundles carry none.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin({
      dts: true,
      actors: { dir: 'src/actors', hmr: true },
      optimizer: { debug: false },
    }),
  ],
})
```

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `autoImports` | `AutoImport[]` | `[]` | Additional auto-import entries injected into the virtual module. |
| `gwenDir` | `string` | `'.gwen'` | Directory where generated files (dts, virtual modules) are written. |
| `dts` | `boolean` | `true` | Emit a `gwen.d.ts` type declaration file. |
| `actors.dir` | `string` | `'src/actors'` | Root directory scanned for actor files. |
| `actors.hmr` | `boolean` | `true` | Enable HMR for actor modules. |
| `layout.include` | `string[]` | — | Glob patterns of layout files to include. |
| `layout.disableNameInjection` | `boolean` | `false` | When true, the `gwen:layout-name` unit is not registered. |
| `sceneRouter` | `GwenSceneRouterOptions` | — | When `disableNameInjection` is true, the `gwen:scene-router-name` unit is not registered. |
| `tween` | `GwenTweenOptions` | — | Options forwarded to the tween transform. |
| `optimizer` | `boolean \| GwenOptimizerUserOptions` | — | Reserved. Accepted and ignored until the hot-path rewrite of #69. |

### The `optimizer` option

Reserved. Accepted and ignored until the hot-path rewrite of #69. It accepts `boolean` or `{ debug?: boolean }` and is a no-op today. `gwen()` accepts the same option (`GwenPluginOptions.optimizer`), also ignored.

```ts
gwenVitePlugin()

gwenVitePlugin({ optimizer: true })

gwenVitePlugin({ optimizer: { debug: true } })
```

---

## `physics2dVitePlugin()`

Build-time Vite plugin for 2D physics. Layer inlining is the `gwen:layer-inline` unit, registered on `gwen:transform-pipeline` from this plugin's `configResolved`. A reference such as `Layers.wall` becomes its numeric value. The source map comes from the pipeline transform.

:::tip Auto-registered
When you use the `@gwenjs/physics2d` module in `gwen.config.ts`, this plugin is registered automatically. You do not need to add it manually in most cases.
:::

`Physics2DConfig` has no `vite` key. The module calls `physics2dVitePlugin()` with no options.

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: {
    gravity: { y: -9.81 },
  },
})
```

### Manual usage

`gwen()` must be in the Vite config, so `gwen:transform-pipeline` is present. Without it, the plugin throws `PHYSICS2D:VITE_PIPELINE_MISSING`.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwen } from '@gwenjs/vite'
import { physics2dVitePlugin } from '@gwenjs/physics2d/module'

export default defineConfig({
  plugins: [gwen(), physics2dVitePlugin()],
})
```

---

## `physics3dVitePlugin(options?)`

Build-time Vite plugin for 3D physics support. Provides two features:

1. **Layer inlining** — the `gwen:layer-inline` unit, registered on `gwen:transform-pipeline`. Named layer references become their numeric values. Manual usage needs `gwen()` in the Vite config.
2. **BVH pre-baking** — when `bvhPrebake: true`, the `gwen:bvh-prebake` unit rewrites `useMeshCollider` when its first argument is a relative `.glb` string (`./` or `../`). The arguments become `{ __bvhUrl: "bvh-<hash>.bin" }`. A build emits that file name. Dev serves the same bytes from memory at `GET <base><name>`. An absent file or a failed bake throws `VITE:BVH_PREBAKE_FAILED`. `useConvexCollider` is not rewritten. Other keys of the second argument are dropped.

:::tip Auto-registered
When you use the `@gwenjs/physics3d` module in `gwen.config.ts`, this plugin is registered automatically. You do not need to add it manually in most cases.
:::

### Module config (`vite` sub-key)

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics3d'],
  physics3d: {
    gravity: { x: 0, y: -9.81, z: 0 },
    vite: {
      bvhPrebake: true,
    },
  },
})
```

### Manual usage

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwen } from '@gwenjs/vite'
import { physics3dVitePlugin } from '@gwenjs/physics3d/module'

export default defineConfig({
  plugins: [gwen(), physics3dVitePlugin({ bvhPrebake: true })],
})
```

`gwen()` must be in the Vite config. Without `gwen:transform-pipeline`, the plugin throws `PHYSICS3D:VITE_PIPELINE_MISSING`.

### Options

| Option | Type | Default | Description |
|---|---|---|---|
| `bvhPrebake` | `boolean` | `false` | Rewrite a relative `useMeshCollider` `.glb` path. Dev serves the baked asset from memory. |

---

## `@gwenjs/vite/scanners`

`scanScenes` and `resolveMainScene` are exported from `@gwenjs/vite/scanners` (`packages/vite/package.json:22`). `scanScenes` reads `src/scenes/*.ts` and returns one `SceneInfo` per file (`packages/vite/src/scanners/index.ts:118`). `resolveMainScene` returns the given `mainScene` when it was discovered (`packages/vite/src/scanners/index.ts:202`), and the first scene when `mainScene` is omitted (`packages/vite/src/scanners/index.ts:204`).

## `ViteErrorCodes`

Exported from `@gwenjs/vite`.

| Key | Code |
|---|---|
| `SCENE_NAME_UNRESOLVED` | `VITE:SCENE_NAME_UNRESOLVED` |
| `SCENE_NAME_DUPLICATE` | `VITE:SCENE_NAME_DUPLICATE` |
| `MAIN_SCENE_UNKNOWN` | `VITE:MAIN_SCENE_UNKNOWN` |

`scanScenes` throws `VITE:SCENE_NAME_UNRESOLVED` and `VITE:SCENE_NAME_DUPLICATE`. `resolveMainScene` throws `VITE:MAIN_SCENE_UNKNOWN`. Those three hints are present when `process.env["NODE_ENV"]` is not `"production"` (`packages/vite/src/scanners/index.ts:142`, `packages/vite/src/scanners/index.ts:157`, `packages/vite/src/scanners/index.ts:196`).

## Type Definitions

### `GwenViteOptions`

```ts
interface GwenViteOptions {
  autoImports?: AutoImport[]
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
  optimizer?: boolean | { debug?: boolean }
}
```
