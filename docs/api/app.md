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

| Property | Type | Description |
|---|---|---|
| `modules` | `GwenModuleEntry[]` | List of modules to activate (e.g., `['@gwenjs/physics2d']` or `[['@gwenjs/input', { gamepad: true }]]`) |
| `engine.maxEntities` | `number` | Max simultaneous entities (default 10_000) |
| `engine.targetFPS` | `number` | Target FPS (default 60) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | WASM variant to load |
| `engine.loop` | `'internal' \| 'external'` | Game loop ownership (default 'internal') |
| `engine.maxDeltaSeconds` | `number` | Max delta time per frame (default 0.1s) |
| `vite` | `Record<string, unknown>` | Direct Vite config extension |
| `hooks` | `Partial<GwenBuildHooks>` | Build-time hook subscriptions |
| `plugins` | `GwenPlugin[]` | Plugins to register directly (escape hatch) |

**Example:**
```ts
const config: GwenUserConfig = {
  modules: [
    '@gwenjs/physics2d',
    ['@gwenjs/input', { gamepad: true }],
  ],
  engine: {
    maxEntities: 5_000,
    targetFPS: 60,
    variant: 'physics2d',
  },
}
```

### ResolvedGwenConfig

**Signature:**
```ts
interface ResolvedGwenConfig extends GwenUserConfig {
  // Same as GwenUserConfig but with all defaults applied
}
```

**Description.** Fully resolved configuration with all defaults applied. Used internally.

### GwenModuleOptions

**Signature:**
```ts
interface GwenModuleOptions {
  name: string;
  version?: string;
  auto?: AutoImport[];
  [key: string]: any;
}
```

**Description.** Options for a GWEN module registered in the build system.

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Module identifier |
| `version` | `string` | Module version (optional) |
| `auto` | `AutoImport[]` | Auto-import rules for build |

### GwenBuildHooks

**Signature:**
```ts
interface GwenBuildHooks {
  'app:config': Hook<(config: ResolvedGwenConfig) => void>;
  'app:resolved': Hook<(config: ResolvedGwenConfig) => void>;
  // Additional build hooks
}
```

**Description.** Build-time hooks for app initialization and configuration resolution.

**Example:**
```ts
const plugin: PluginDef = {
  name: 'my-plugin',
  hooks: {
    'app:config': (config) => {
      console.log('App config resolved:', config);
    }
  }
};
```
