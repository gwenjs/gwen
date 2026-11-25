# @gwenjs/vite

**GWEN Vite Plugin — manifest injection, virtual entry, and scene scan**

Integrate GWEN with Vite: inject the manifest, resolve the virtual entry, and scan scenes.

## Installation

```bash
npm install -D @gwenjs/vite
```

## Quick Start

### Add to vite.config.ts

```typescript
import { defineConfig } from "vite";
import { gwen } from "@gwenjs/vite";

export default defineConfig({
  plugins: [
    gwen({
      manifestPath: "./gwen-manifest.json",
    }),
  ],
});
```

### Minimal setup

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { gwen } from "@gwenjs/vite";

export default defineConfig({
  plugins: [gwen()],
});
```

## Features

### 1. **Scene Auto-Discovery**

Scans `src/scenes/` and generates scene registry automatically.

```typescript
// Scenes are auto-discovered from src/scenes/*.ts
// Example: src/scenes/GameScene.ts → auto-registered
```

### 2. **Manifest Injection**

Injects `gwen-manifest.json` as a virtual module.

```typescript
import manifest from "virtual:gwen-manifest";

console.log(manifest.version);
console.log(manifest.buildDate);
```

## Configuration

```typescript
interface GwenPluginOptions {
  // Path to gwen-manifest.json (optional)
  manifestPath?: string;
  // true or an object registers gwen:hoist-chunk-columns.
  optimizer?: boolean | { debug?: boolean };
}
```

## Examples

### Development Setup

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import { gwen } from "@gwenjs/vite";

export default defineConfig({
  plugins: [
    gwen({
      manifestPath: "./gwen-manifest.json",
    }),
  ],
});
```

### With Scene Auto-Discovery

```typescript check
// src/scenes/GameScene.ts
import { defineScene, onEnter } from "@gwenjs/core/scene";

export const GameScene = defineScene("game", () => {
  onEnter(() => {
    console.log("Game started!");
  });
});

// src/scenes/MenuScene.ts
export const MenuScene = defineScene("menu", () => {
  onEnter(() => {
    console.log("Menu opened!");
  });
});
```

## Virtual Modules

### `virtual:gwen-manifest`

Access build metadata:

```typescript
import manifest from "virtual:gwen-manifest";

console.log(manifest.version); // Package version
console.log(manifest.buildDate); // Build timestamp
```

## Troubleshooting

### Scene Discovery Not Working

- Place scenes in `src/scenes/` directory
- Call `defineScene()` with a string literal name. A helper file starts with `_`

## See Also

- [@gwenjs/core](../engine-core/) — Core engine
- [@gwenjs/cli](../cli/) — Command-line interface
- [Vite Documentation](https://vitejs.dev)

## Public exports

### `.`

Values: `ViteErrorCodes`, `default`, `gwen`, `gwenPhysics3DOptimizerPlugin`, `gwenVitePlugin`

Types: `ActorPluginOptions`, `CoreVariant`, `GwenDevStripReport`, `GwenPhysics3DOptimizerOptions`, `GwenPluginOptions`, `GwenViteOptions`

`GwenDevStripReport` — Numeric `sites`, `sourceBytes`, and `perFrameSites`.

### `./shared/layer-utils`

Values: `createBvhPrebakeTransform`, `evalConstInt`, `layerInlineTransform`

Types: none

### `./scanners`

Values: `resolveMainScene`, `scanDefineHooks`, `scanEasingNames`, `scanLayoutNames`, `scanScenes`, `scanWasmModuleNames`

Types: `HookExport`, `LayoutName`, `ScanOptions`, `SceneInfo`, `WasmModuleHit`, `WasmModuleScan`, `WasmModuleSkip`

### `./internal`

no semver guarantee — framework packages and generated code only

Values: `generateEntryModule`, `generateScenesModule`

Types: `EntryResolvedConfig`
