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
function defineConfig(input: GwenConfigInput): GwenUserConfig
```

**Description.** Defines the top-level GWEN app configuration. Used in your app config file (typically `gwen.config.ts`).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| input | `GwenConfigInput` | Configuration object |

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
| `modules` | `string[]` | `[]` | Modules to activate. Each entry is the npm package name. Module options are declared as a top-level key (e.g. `physics2d: { gravity: -9.81 }`). |
| `engine.maxEntities` | `number` | `10_000` | Max simultaneous entities. |
| `engine.targetFPS` | `number` | `60` | Target frames per second. |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | auto | WASM core variant to load. Auto-detected from `modules` when omitted. |
| `engine.loop` | `'internal' \| 'external'` | `'internal'` | Who owns the game loop (`requestAnimationFrame`). |
| `engine.maxDeltaSeconds` | `number` | `0.1` | Maximum delta time clamp per frame (seconds). |
| `engine.debug` | `boolean` | `false` | Enables verbose logging, per-frame sentinel checks, phase timing warnings, and plugin setup logs. |
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
  engine: Required<NonNullable<GwenUserConfig['engine']>>
  modules: GwenModuleEntry[]
}
```

**Description.** Fully resolved configuration with all defaults filled in. Used internally and passed to module `setup()` functions.

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
