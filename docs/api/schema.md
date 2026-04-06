---
title: "@gwenjs/schema"
description: "API reference for @gwenjs/schema."
---

# @gwenjs/schema

`pnpm add @gwenjs/schema`

Shared type definitions and configuration utilities for GWEN. Primarily used internally and by plugin authors. Provides unified types for components, systems, hooks, and engine configuration.

## Type Definitions

### GwenPluginBase

**Signature:**
```ts
interface GwenPluginBase {
  name: string;
  version?: string;
  description?: string;
}
```

**Description.** Base interface for all plugins. Must include name and optional version/description.

### GwenHookHandler

**Signature:**
```ts
type GwenHookHandler<T = any> = (context: T) => void | Promise<void>
```

**Description.** Handler function type for lifecycle hooks.

### GwenModuleEntry

**Signature:**
```ts
interface GwenModuleEntry {
  name: string;
  exports: Record<string, string>;
  hooks?: Record<string, GwenHookHandler>;
}
```

**Description.** Represents an entry in the module registry.

### GwenOptions

**Signature:**
```ts
interface GwenOptions {
  [key: string]: any;
}
```

**Description.** Generic options object for extensibility.

### GwenConfigInput

**Signature:**
```ts
interface GwenConfigInput {
  plugins?: PluginDef[];
  scenes?: SceneDef[];
  initialScene?: string;
  wasm?: 'light' | 'physics2d' | 'physics3d';
  logger?: LoggerOptions;
  debug?: boolean;
  [key: string]: any;
}
```

**Description.** User-provided configuration input for GWEN.

| Property | Type | Description |
|---|---|---|
| `plugins` | `PluginDef[]` | Plugins to load |
| `scenes` | `SceneDef[]` | Available scenes |
| `initialScene` | `string` | Initial scene name |
| `wasm` | `string` | WASM variant |
| `logger` | `LoggerOptions` | Logger config |
| `debug` | `boolean` | Debug mode |

### DeepPartial\<T\>

**Signature:**
```ts
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
}
```

**Description.** Recursively makes all properties optional.

### EngineAPI

**Signature:**
```ts
interface EngineAPI {
  name: string;
  version: string;
  deltaTime: number;
  isRunning: boolean;
  start(): void;
  stop(): void;
  update(dt: number): void;
  render(): void;
}
```

**Description.** Core engine runtime interface.

## Configuration Functions

### defaultOptions()

**Signature:**
```ts
function defaultOptions(): GwenOptions
```

**Description.** Returns default GWEN options.

**Returns:** `GwenOptions` — default configuration object.

**Example:**
```ts
const defaults = defaultOptions();
```

### resolveConfig(input)

**Signature:**
```ts
function resolveConfig(input: GwenConfigInput): ResolvedGwenConfig
```

**Description.** Resolves and merges user config with defaults.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| input | `GwenConfigInput` | User-provided configuration |

**Returns:** `ResolvedGwenConfig` — fully resolved configuration.

**Example:**
```ts
const config = resolveConfig({
  scenes: [GameScene],
  initialScene: 'Game'
});
```

### validateResolvedConfig(config)

**Signature:**
```ts
function validateResolvedConfig(config: ResolvedGwenConfig): boolean
```

**Description.** Validates a resolved configuration for correctness.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| config | `ResolvedGwenConfig` | Configuration to validate |

**Returns:** `boolean` — true if valid, throws error otherwise.

**Example:**
```ts
try {
  validateResolvedConfig(myConfig);
  console.log('Config is valid');
} catch (error) {
  console.error('Invalid config:', error);
}
```

### assertModuleFirstInput(input)

**Signature:**
```ts
function assertModuleFirstInput(input: any): asserts input is GwenModuleEntry
```

**Description.** Type guard that asserts input is a valid module entry. Throws if invalid.

**Example:**
```ts
assertModuleFirstInput(moduleData);
// After this, TypeScript knows moduleData is GwenModuleEntry
```

## Lifecycle Hooks

### EngineLifecycleHooks

**Signature:**
```ts
interface EngineLifecycleHooks {
  'engine:init': GwenHookHandler;
  'engine:start': GwenHookHandler;
  'engine:stop': GwenHookHandler;
  'engine:update': GwenHookHandler<{ dt: number }>;
  'engine:render': GwenHookHandler;
}
```

**Description.** Engine lifecycle hooks for plugins.

### PluginLifecycleHooks

**Signature:**
```ts
interface PluginLifecycleHooks {
  'plugin:load': GwenHookHandler;
  'plugin:setup': GwenHookHandler;
  'plugin:unload': GwenHookHandler;
}
```

**Description.** Plugin lifecycle hooks.

### EntityLifecycleHooks

**Signature:**
```ts
interface EntityLifecycleHooks {
  'entity:create': GwenHookHandler<{ entity: Entity }>;
  'entity:destroy': GwenHookHandler<{ entity: Entity }>;
}
```

**Description.** Entity lifecycle hooks.

### ComponentLifecycleHooks

**Signature:**
```ts
interface ComponentLifecycleHooks {
  'component:add': GwenHookHandler<{ entity: Entity; component: any }>;
  'component:remove': GwenHookHandler<{ entity: Entity; component: any }>;
}
```

**Description.** Component lifecycle hooks.

### SceneLifecycleHooks

**Signature:**
```ts
interface SceneLifecycleHooks {
  'scene:enter': GwenHookHandler<{ scene: string }>;
  'scene:exit': GwenHookHandler<{ scene: string }>;
}
```

**Description.** Scene lifecycle hooks.
