---
title: "@gwenjs/schema"
description: "API reference for @gwenjs/schema."
---

# @gwenjs/schema

`pnpm add @gwenjs/schema`

Shared type definitions and configuration utilities for GWEN. Primarily used internally and by plugin authors. Provides unified types for components, systems, hooks, and engine configuration.

## Type Definitions

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
  engine: {
    maxEntities: number;
    targetFPS: number;
    debug: boolean;
    enableStats: boolean;
    sparseTransformSync: boolean;
    loop: "internal" | "external";
    maxDeltaSeconds: number;
  };
  html: {
    title: string;
    background: string;
  };
  modules: GwenModuleEntry[];
  plugins: GwenPluginBase[];
  scenes: string[];
  scenesMode: "auto" | false;
  mainScene?: string;
  rootDir?: string;
  srcDir: string;
  outDir: string;
  dev?: boolean;
}
```

**Description.** Fully resolved engine configuration. Optional fields may be absent. The rest are filled with defaults.

### GwenConfigInput

**Signature:**
```ts
interface GwenConfigInput extends DeepPartial<GwenOptions> {
  plugins?: GwenPluginBase[];
  tsPlugins?: GwenPluginBase[];
  wasmPlugins?: GwenPluginBase[];
}
```

**Description.** Partial user configuration. It extends `DeepPartial<GwenOptions>` and still accepts the legacy plugin lists.

| Property | Type | Description |
|---|---|---|
| `plugins` | `GwenPluginBase[]` | Legacy plugin array. Prefer `modules`. |
| `tsPlugins` | `GwenPluginBase[]` | Legacy TypeScript plugin list. |
| `wasmPlugins` | `GwenPluginBase[]` | Legacy WASM plugin list. |

Every `GwenOptions` field is also accepted, and all of them are optional.

### DeepPartial\<T\>

**Signature:**
```ts
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
}
```

**Description.** Recursively makes all properties optional.

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
  modules: ['@gwenjs/physics2d'],
  mainScene: 'game',
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
function assertModuleFirstInput(input: GwenConfigInput): void
```

**Description.** Throws if legacy `plugins`, `tsPlugins`, or `wasmPlugins` are set and `modules` is empty. The return type is `void`. This is not a type guard.

**Example:**
```ts
assertModuleFirstInput(input);
```
