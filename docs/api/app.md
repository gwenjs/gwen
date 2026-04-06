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
  plugins: [Physics2DPlugin()],
  scenes: [MainScene, MenuScene],
  initialScene: 'Menu',
  wasm: 'physics2d',
  debug: true
});
```

## Configuration Options

### GwenUserConfig

**Properties:**

| Property | Type | Description |
|---|---|---|
| `plugins` | `PluginDef[]` | List of plugins to load |
| `scenes` | `SceneDef[]` | Available scenes |
| `initialScene` | `string` | Name of initial scene to load |
| `wasm` | `'light' \| 'physics2d' \| 'physics3d'` | WASM variant to include |
| `logger` | `LoggerOptions` | Logger configuration |
| `debug` | `boolean` | Enable debug mode |

**Example:**
```ts
const config: GwenUserConfig = {
  plugins: [Physics2DPlugin(), CustomPlugin()],
  scenes: [GameScene],
  initialScene: 'Game',
  wasm: 'physics2d',
  logger: { level: 'info' },
  debug: false
};
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
