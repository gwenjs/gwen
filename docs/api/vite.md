---
title: "@gwenjs/vite"
description: "API reference for @gwenjs/vite."
---

# @gwenjs/vite

`pnpm add @gwenjs/vite`

Vite integration for GWEN. Handles WASM bundling, hot-reload, and asset injection for seamless development workflows.

## Main Plugin

### gwen(options)

**Signature:**
```ts
function gwen(options?: GwenVitePluginOptions): VitePlugin
```

**Description.** The main Vite plugin factory for GWEN projects. Handles WASM bundling, hot-reload, and manifest injection. This is the primary plugin you'll register in your Vite config.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `GwenVitePluginOptions` | Plugin configuration |
| options.cratePath | `string` | Path to Rust crate (optional) |
| options.watch | `boolean` | Enable WASM hot-reload (default: true in dev) |
| options.wasmDir | `string` | Output directory for WASM files (default: 'dist/wasm') |

**Returns:** `VitePlugin` — Vite plugin instance.

**Example:**
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { gwen } from '@gwenjs/vite';

export default defineConfig({
  plugins: [
    gwen({
      cratePath: './rust-wasm',
      watch: true,
      wasmDir: 'dist/wasm'
    })
  ]
});
```

## Features

### WASM Bundling

The plugin automatically:
- Detects and bundles WASM modules from your project
- Injects WASM loading code into the build
- Handles file extensions and path resolution

### WASM Hot-Reload

When `watch: true` (default in dev mode):
- WASM files are reloaded without full page refresh
- Development iteration is fast and smooth
- Rebuilds only affected WASM modules

**Example:**
```ts
gwen({
  watch: true // Enable during development
})
```

### Manifest Injection

The plugin injects WASM manifest via `__GWEN_MANIFEST__` global variable:
- Available at runtime to access WASM module paths
- Automatically generated during build
- Contains all bundled WASM metadata

**Usage in code:**
```ts
// At runtime, __GWEN_MANIFEST__ contains:
// { wasmModules: { 'physics2d': '...' }, ... }
const manifest = globalThis.__GWEN_MANIFEST__;
```

## Physics Plugins

The vite package re-exports physics plugins for convenience:

### physics2dVitePlugin()

**Signature:**
```ts
function physics2dVitePlugin(): VitePlugin
```

**Description.** Vite plugin for 2D physics (Rapier2D). Auto-registered when Physics2DPlugin is used.

**Example:**
```ts
import { physics2dVitePlugin } from '@gwenjs/vite';

// Usually not needed—Physics2DPlugin handles this automatically
plugins: [physics2dVitePlugin()]
```

### physics3dVitePlugin()

**Signature:**
```ts
function physics3dVitePlugin(): VitePlugin
```

**Description.** Vite plugin for 3D physics (Rapier3D). Auto-registered when Physics3DPlugin is used.

## Type Definitions

### GwenVitePluginOptions

```ts
interface GwenVitePluginOptions {
  cratePath?: string;
  watch?: boolean;
  wasmDir?: string;
}
```

**Properties:**

| Property | Type | Description |
|---|---|---|
| `cratePath` | `string` | Path to Rust crate containing WASM source (optional) |
| `watch` | `boolean` | Enable WASM hot-reload in dev mode (default: true) |
| `wasmDir` | `string` | Output directory for compiled WASM files (default: 'dist/wasm') |

**Example:**
```ts
const options: GwenVitePluginOptions = {
  cratePath: './crates/wasm',
  watch: true,
  wasmDir: 'public/wasm'
};
```

## Integration Example

Complete Vite setup with GWEN:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { gwen } from '@gwenjs/vite';

export default defineConfig({
  plugins: [
    react(),
    gwen({
      cratePath: './wasm',
      watch: true,
      wasmDir: 'dist/wasm'
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  }
});
```

## Development Workflow

1. **Start dev server:**
   ```bash
   vite
   ```

2. **WASM changes are hot-reloaded** automatically when `watch: true`

3. **Build for production:**
   ```bash
   vite build
   ```

The plugin handles all WASM compilation and injection transparently.
