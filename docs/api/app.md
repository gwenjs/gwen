---
title: "@gwenjs/app"
description: "API reference for @gwenjs/app."
---

# @gwenjs/app

`pnpm add @gwenjs/app`

High-level app configuration and module system for GWEN projects. Integrates with the build system and plugin ecosystem.

## Configuration

### defineConfig(input)

**Signature:**
```ts
function defineConfig(input: GwenUserConfig): GwenUserConfig
```

**Description.** Defines the top-level GWEN app configuration. Used in your app config file (typically `gwen.config.ts`).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| input | `GwenUserConfig` | Configuration object |

**Returns:** `GwenUserConfig` — validated configuration.

**Example:**
```ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    variant: 'physics2d',
  },
})
```

## Configuration Options

### GwenUserConfig

**Properties:**

| Property | Type | Default | Description |
|---|---|---|---|
| `mainScene` | `string` | first scene file | Name of the initial scene (must match the first argument of a `defineScene()` call). By default the framework picks the first scene file alphabetically — set this explicitly when your initial scene is not the first one. |
| `modules` | `string[]` | `[]` | Modules to activate. Each entry is the npm package name. Module options are declared as a top-level key (e.g. `physics2d: { gravity: -9.81 }`). |
| `engine.maxEntities` | `number` | `10_000` | Max simultaneous entities. |
| `engine.targetFPS` | `number` | `60` | Target frames per second. |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | auto | WASM core variant to load. Auto-detected from `modules` when omitted. |
| `engine.loop` | `'internal' \| 'external'` | `'internal'` | Who owns the game loop (`requestAnimationFrame`). |
| `engine.maxDeltaSeconds` | `number` | `0.1` | Maximum delta time clamp per frame (seconds). |
| `engine.physicsHz` | `number` | `0` | Fixed simulation rate in Hz. When non-zero, each display frame runs up to `maxCatchupSteps` steps and one `engine:render(alpha)`. `advance(dt)` uses the same accumulator. |
| `engine.maxCatchupSteps` | `number` | `2` | Maximum fixed steps per display frame. Whole steps beyond the cap are dropped. |
| `engine.debug` | `boolean` | `false` | When `logger.minLevel` is omitted, `true` lowers the engine logger minimum level to `debug` (plugin setup logs included). A set `logger.minLevel` wins. Per-frame sentinel checks, phase timing, and the isolation warning run only when `__GWEN_DEV__` is also true (`true` with `vite` and `vite build --mode development`, `false` with `vite build`). |
| `logger.providers` | `IGwenLogProvider[]` | console provider | Providers for the engine logger. Passed to `createEngine`. `[]` delivers nothing. |
| `logger.minLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | `debug` when `engine.debug` is true and this is omitted, otherwise `warn` | Minimum level delivered to the providers. When set, it wins over `engine.debug`. |
| `globalCss` | `string[]` | `[]` | CSS files injected into every page, relative to project root (e.g. `'./src/styles/global.css'`). |
| `viewports` | `Record<string, ViewportRegion>` | — | Static viewport declarations (normalized 0–1 screen regions). If absent, a fullscreen `'main'` viewport is created automatically. |
| `screen.sizeProvider` | `ScreenSizeProvider` | auto | Custom size provider for `ScreenPlugin`. Auto-detected in browser (ResizeObserver). Required for Node.js or non-browser environments. |
| `hooks` | `Partial<GwenBuildHooks>` | — | Build-time hook subscriptions. |
| `plugins` | `GwenPlugin[]` | — | Runtime plugins to register directly, without a module wrapper. |

**Example:**
```ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: { gravity: -9.81 },
  engine: {
    maxEntities: 5_000,
    targetFPS: 60,
    variant: 'physics2d',
    debug: true,
  },
  globalCss: ['./src/styles/reset.css'],
  viewports: {
    main: { x: 0, y: 0, width: 1, height: 1 },
  },
  // Node.js only — browser detects size automatically via ResizeObserver
  // screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) },
})
```

### ResolvedGwenConfig

**Signature:**
```ts
type ResolvedGwenConfig = GwenUserConfig & {
  engine: GwenEngineConfig
  modules: string[]
  logger: GwenLoggerConfig & { minLevel: GwenLogLevel }
}
```

**Description.** Fully resolved configuration with engine defaults filled in. `engine.variant` is the explicit value, or the variant derived from `modules`. A module reads it on `gwen.options`.

`resolveGwenConfig` loads `gwen.config.ts`. Plain objects merge deeply. An array from the higher layer replaces the lower array. `undefined` leaves the lower value. `null` is a value. A function or a class instance is kept by reference.

A module entry is a package-name string. A tuple, an unknown top-level key, or a field of the wrong shape fails the load with `APP:CONFIG_INVALID`. The message names the path, the expected shape, and the received value. An explicit `engine.variant` that contradicts a physics module, a reserved `configKey`, or two modules sharing one `configKey` fails with `APP:CONFIG_CONFLICT`. There is no top-level `debug` block. `engine.loop` is `"internal"` or `"external"`.

c12 does not read `.env`, rc files, `package.json`, or `$test` / `$development` layers.

### GwenBuildHooks

**Signature:**
```ts
interface GwenBuildHooks {
  'build:before': () => void
  'build:done':   () => void
  'module:before': (mod: { meta: { name: string } }) => void
  'module:done':   (mod: { meta: { name: string } }) => void
  'vite:extendConfig': (config: ViteUserConfig) => void
}
```

**Description.** Build-time hooks available in `gwen.config.ts` via the `hooks` field, or inside a module via `gwen.hook()`.

| Event | Fires when |
|---|---|
| `build:before` | Before any module `setup()` runs |
| `build:done` | After all modules have been set up |
| `module:before` | Before each individual module's `setup()` |
| `module:done` | After each individual module's `setup()` |
| `vite:extendConfig` | When a module calls `gwen.extendViteConfig()` |

**Example:**
```ts
export default defineConfig({
  hooks: {
    'build:done': () => {
      console.log('All modules loaded')
    },
  },
})
```
