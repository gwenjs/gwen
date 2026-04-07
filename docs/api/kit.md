---
title: "@gwenjs/kit"
description: "API reference for @gwenjs/kit."
---

# @gwenjs/kit API Reference

`pnpm add @gwenjs/kit`

## `@gwenjs/kit` — Shared types

Types shared between plugin and module authors.

**Exports:** `AutoImport`, `GwenTypeTemplate`, `DeepPartial`, `VitePlugin`, `ViteUserConfig`

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

### Plugin Definition

#### definePlugin(factory)

**Signature:**
```ts
function definePlugin<T = any>(
  factory: (opts?: T) => PluginDef | ((opts?: T) => PluginDef)
): PluginFactory<T>
```

**Description.** Defines a plugin that can be loaded in a GWEN app. The factory can return a `PluginDef` directly or a function that returns a `PluginDef`.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| factory | `function` | Plugin factory function or definition |

**Returns:** `PluginFactory<T>` — a plugin factory ready to register.

**Example:**
```ts
export const MyPlugin = definePlugin((opts = {}) => ({
  name: 'my-plugin',
  version: '1.0.0',
  async setup(engine) {
    console.log('MyPlugin loaded');
  }
}));

// In your app config:
defineConfig({
  plugins: [MyPlugin()],
  // ...
});
```

## `@gwenjs/kit/module`

Build-time module authoring.

**Exports:** `defineGwenModule`, `GwenModule` (type), `GwenModuleDefinition` (type), `GwenKit` (type), `GwenBuildHooks` (type), `GwenBaseConfig` (type)

**Usage:**
```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import type { GwenKit, GwenModule } from '@gwenjs/kit/module'
```

### Module Definition

#### defineGwenModule(name, api)

**Signature:**
```ts
function defineGwenModule(name: string, api: GwenModuleDefinition): GwenModule
```

**Description.** Defines a GWEN module for build-time auto-imports and module resolution.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | Module identifier (e.g., `@gwenjs/math`) |
| api | `GwenModuleDefinition` | Module definition with exports and hooks |

**Returns:** `GwenModule` — registered module.

**Example:**
```ts
defineGwenModule('@my-org/helpers', {
  exports: {
    'useHelper': './helper.ts',
    'useAnother': './another.ts'
  },
  hooks: {
    'app:config': (config) => {
      console.log('Helpers module loaded');
    }
  }
});
```

### Types

#### GwenModule

**Signature:**
```ts
interface GwenModule {
  name: string;
  exports: Record<string, string>;
  hooks?: Record<string, any>;
}
```

**Description.** Represents a registered GWEN module with exports and hooks.

#### GwenModuleDefinition

**Signature:**
```ts
interface GwenModuleDefinition {
  exports: Record<string, string>;
  hooks?: GwenBuildHooks;
  auto?: AutoImport[];
}
```

**Description.** Definition of a GWEN module for auto-import and build system integration.

| Property | Type | Description |
|---|---|---|
| `exports` | `object` | Map of export names to file paths |
| `hooks` | `GwenBuildHooks` | Build hooks to register |
| `auto` | `AutoImport[]` | Auto-import rules (optional) |

#### GwenKit

**Signature:**
```ts
interface GwenKit {
  modules: Map<string, GwenModule>;
  plugins: Map<string, PluginDef>;
  registerModule(module: GwenModule): void;
  registerPlugin(plugin: PluginDef): void;
}
```

**Description.** The kit registry managing all modules and plugins.

#### GwenBuildHooks

**Signature:**
```ts
interface GwenBuildHooks {
  'app:config': Hook<(config: ResolvedGwenConfig) => void | Promise<void>>;
  'app:resolved': Hook<(config: ResolvedGwenConfig) => void | Promise<void>>;
  'module:register': Hook<(module: GwenModule) => void | Promise<void>>;
  'plugin:setup': Hook<(plugin: PluginDef) => void | Promise<void>>;
}
```

**Description.** Available build-time hooks for plugins and modules.

#### AutoImport

**Signature:**
```ts
interface AutoImport {
  name: string;
  from: string;
  imports?: string[];
}
```

**Description.** Auto-import rule for build system auto-import features.

| Property | Type | Description |
|---|---|---|
| `name` | `string` | Export name |
| `from` | `string` | Module path to import from |
| `imports` | `string[]` | Specific imports to include (optional) |

**Example:**
```ts
const autoImports: AutoImport[] = [
  { name: 'useQuery', from: '@gwenjs/core' },
  { name: 'defineSystem', from: '@gwenjs/core' }
];
```

#### GwenTypeTemplate

**Signature:**
```ts
interface GwenTypeTemplate {
  name: string;
  path: string;
  description?: string;
}
```

**Description.** Template for type definitions that can be auto-generated during the build.
