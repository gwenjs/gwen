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
| `dts` | `boolean` | `true` | Emit `.d.ts` files (auto-imports, wasm modules). |
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

## `@gwenjs/vite/scanners` {#vite-scanners}

`@gwenjs/vite/scanners` reads project files and returns facts about them (`packages/vite/package.json:22`). It has no Vite import, so an app or a CLI can call it without a Vite peer. The pipeline rewrites one module at a time; see [Build Pipeline](/advanced/build-pipeline).

```ts
import {
  scanScenes,
  scanDefineHooks,
  scanLayoutNames,
  scanEasingNames,
  scanWasmModuleNames,
} from '@gwenjs/vite/scanners'

const root = '/path/to/project'
const scenes = scanScenes(root)
const hooks = scanDefineHooks(root)
const layouts = scanLayoutNames(root, ['src/layouts/**/*.ts'])
const easings = scanEasingNames(root)
const wasmModules = scanWasmModuleNames(root, ['src'])
```

| Function | Reads | Returns |
|---|---|---|
| `scanScenes(projectRoot, options?)` | `src/scenes/*.ts` (`packages/vite/src/scanners/index.ts:139`) | `SceneInfo[]` |
| `scanDefineHooks(root, options?)` | `src/hooks.ts`, then `src/hooks/*.ts` in name order (`packages/vite/src/scanners/index.ts:288`) | `HookExport[]`: `{ file, name }` per binding |
| `scanLayoutNames(root, include, options?)` | the files under the base directory of each `include` glob, the text before its first `**` (`packages/vite/src/scanners/index.ts:320`) | `LayoutName[]`: `{ file, name }` per `defineLayout` binding, sorted by file |
| `scanEasingNames(root, options?)` | `src/**` (`packages/vite/src/scanners/index.ts:356`) | `string[]`, sorted and unique |
| `scanWasmModuleNames(root, dirs)` | every `.ts`, `.tsx`, `.js` and `.jsx` file under each directory of `dirs` (`packages/vite/src/scanners/index.ts:532`) | `WasmModuleScan`: `{ hits, skipped }` |

`resolveMainScene(scenes, fromConfig?)` returns the given `mainScene` when it was discovered (`packages/vite/src/scanners/index.ts:222`), and the first scene when `mainScene` is omitted (`packages/vite/src/scanners/index.ts:224`).

- **Hooks.** A binding counts when it is `export const X = defineHooks(...)`, or a top-level `const X = defineHooks(...)` named in `export { X }`. A default export is not typed. `options.file` and `options.dir` replace the default paths, relative to `root`.
- **Easings.** A name counts when it is the string literal of `easing:` in an object argument of a `useTween` call. A template literal or an identifier is not read.
- **Wasm module names.** A call counts when it is `<object>.loadWasmModule<T>({ name: '<literal>' })`, or a bare call of a `loadWasmModule` bound by a destructuring pattern. This scanner matches the method name, not an import binding. A local function with that name, an aliased method, `.call`, `.apply`, `Reflect.apply` and a computed property are not seen. `T` must be a type imported by name. A call with a name that is not a string literal, with no type argument, or with a type that is not importable (declared in the same file, generic, inline or namespaced) goes to `skipped`, with the reason `non-literal name`, `no type argument` or `type not importable`. A `node_modules` directory is never entered. Each hit is `{ name, typeImport: { from, name }, file, line }`; `from` is the specifier as written and `name` is the original export name. [Typed names](/kit/custom-plugin#typed-names) shows what the Vite plugin writes from it.
- **Strict parse.** Every scanner parses with `parseModule`. A file with a syntax error throws `VITE:TRANSFORM_PARSE_FAILED` and names `<file>:<line>:<column>`. A file that cannot be read throws the same code, with the Node error as `cause` (`packages/vite/src/scanners/read.ts:39`). No file is skipped.
- **`autoImports`.** Callees match through import bindings, never by text. Pass `options.autoImports` (type `ScanOptions`) to match a bare `defineScene(...)` that relies on an auto-import. Without it, only an explicit import from a GWEN package matches. An alias and a namespace import match. A local function with the same name, or a function from another package, does not.
- **No barrels.** A scanner does not follow a re-export (`packages/vite/src/scanners/read.ts:50`). A scanned file must import the GWEN function from its package, or rely on `autoImports`.

## `ViteErrorCodes`

Exported from `@gwenjs/vite`.

| Key | Code |
|---|---|
| `SCENE_NAME_UNRESOLVED` | `VITE:SCENE_NAME_UNRESOLVED` |
| `SCENE_NAME_DUPLICATE` | `VITE:SCENE_NAME_DUPLICATE` |
| `MAIN_SCENE_UNKNOWN` | `VITE:MAIN_SCENE_UNKNOWN` |
| `WASM_MODULE_DUPLICATE` | `VITE:WASM_MODULE_DUPLICATE` |

`scanScenes` throws `VITE:SCENE_NAME_UNRESOLVED` and `VITE:SCENE_NAME_DUPLICATE`. `resolveMainScene` throws `VITE:MAIN_SCENE_UNKNOWN`. Those three hints are present when `process.env["NODE_ENV"]` is not `"production"` (`packages/vite/src/scanners/index.ts:162`, `packages/vite/src/scanners/index.ts:177`, `packages/vite/src/scanners/index.ts:216`).

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
