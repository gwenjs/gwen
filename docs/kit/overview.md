---
title: Plugin System Overview
description: GWEN is extended through plugins and modules via @gwenjs/kit.
---

# Plugin System Overview

GWEN ships with an ECS core and nothing else. No renderer, no input handler, no audio system, no physics engine. Everything beyond ECS is a **plugin**—and you pick only what your game needs. Preloading is a core seam (`onPreload`, #116); loaders live in `@gwenjs/assets`. See [ADR-0005](https://github.com/gwenjs/gwen/blob/v1-alpha/internals-docs/adr/0005-asset-management.md).

The plugin system consists of two complementary mechanisms:

1. **Plugins** — Runtime extensions that hook into the engine lifecycle
2. **Modules** — Build-time extensions that configure the GWEN project

Together they allow you to extend GWEN with custom or third-party capabilities.

## Plugins vs Modules

| Aspect | Plugin | Module |
|--------|--------|--------|
| Defined with | `definePlugin()` from `@gwenjs/kit` | `defineGwenModule()` from `@gwenjs/kit/module` |
| Registered in | `src/plugins/` (auto-discovered) or `gwen.addPlugin()` inside a module | `src/modules/` (auto-discovered) or `modules` key in `gwen.config.ts` |
| Execution context | Runtime (browser) | Build-time (Node.js: `gwen dev`, `gwen build`, `gwen prepare`) |
| Scope | Engine-wide lifecycle | Feature setup, configuration, code generation |
| Example | Input handling, physics simulation | Registering plugins, auto-imports, Vite extensions |
| Access | `engine` instance passed to `setup()` | `gwen` build API passed to `setup()` |

## Quick Example

### Plugin

A simple plugin that listens to keyboard events:

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (k: string) => boolean }
  }
}

export const InputPlugin = definePlugin({ provides: ['input'] }, () => ({
  name: 'input',
  setup(engine) {
    const keys = new Set<string>()

    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })

    // Store for access in systems (via services)
    engine.provide('input', { isKeyDown: (k: string) => keys.has(k) })
  },
}))
```

::: info Named vs default export
This named-export form is used when a module registers the plugin via `gwen.addPlugin({ src: "@my-scope/input", export: "InputPlugin" })`. For `src/plugins/` auto-discovery, use `export default definePlugin(...)` instead — see [Register in Project](#register-in-project) below.
:::

### Module

A module that sets up the Input plugin and auto-imports:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: { name: '@my-scope/input', configKey: 'input' },
  setup(options, gwen) {
    gwen.addPlugin({ src: "@my-scope/input", export: "InputPlugin" })
    gwen.addAutoImports([
      { name: 'useInput', from: '@my-scope/input' },
    ])
  },
})
```

### Register in Project

**Option A — Local file (project-specific, no config needed):**

Drop a file in `src/plugins/`. GWEN discovers and registers it automatically:

```ts
// src/plugins/input.ts — export default, not a named export
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (k: string) => boolean }
  }
}

export default definePlugin({ provides: ['input'] }, () => ({
  name: 'input',
  setup(engine) {
    // same setup as any plugin
    engine.provide('input', { /* ... */ })
  },
}))
```

Local plugins run after `config.plugins` — see [Load Order](/guide/project-structure#load-order) for the full sequence.

::: tip Flat files only
`src/plugins/input.ts` ✅ — `src/plugins/input/index.ts` ❌. Subdirectories are not scanned.
:::

**Option B — Module in `gwen.config.ts` (npm packages or options from config):**

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/input'],
  input: { preventDefault: ['ArrowUp', 'ArrowDown'] },
})
```

The module package itself calls `gwen.addPlugin()` in its `setup()`. The `gwen.config.ts` entry only tells GWEN which module to load.

## When to Use Each

**Use a Plugin when:**
- You need to hook into the engine lifecycle (`setup`, hooks, `teardown`)
- You want to provide runtime services to systems
- You're implementing game logic or rendering

**Use a Module when:**
- You need to configure build-time behavior
- You're registering multiple plugins or auto-imports as a cohesive feature
- You want to extend the Vite build pipeline
- You need to generate type definitions for IDE auto-complete

**Register a module:**
- Drop a file in `src/modules/` for project-local modules (auto-discovered)
- Add to `modules` in `gwen.config.ts` for npm packages

## Type casts in the GWEN packages

The sources of the GWEN packages (`packages/*/src`) pass four type gates in `oxlint.json`: no `as X` (except `as const`), no `!` non-null assertion, no `any`, no ts-ignore directive, and no ts-expect-error directive without a description. A cast stays only for a value that comes from WASM, a worker, parsed source code or a third-party type that TypeScript cannot check, or for a generic or heterogeneous storage case that TypeScript cannot express without a public type change (per-engine tables that store actors of different props, for example), or for a value that is built empty or pre-sized and filled afterwards (a Proxy target, a pre-sized buffer), or for a removal that the caller has proven, when TypeScript cannot express the proof. The file is then listed in the override of `oxlint.json` that turns off only `typescript/consistent-type-assertions`, and the cast carries `// boundary: <reason>` on the same line. Small package-local helpers in `src/internal/unchecked.ts` hold the casts that the caller proves: an indexed read inside a loop bound, a `pop()` on a non-empty array, a `Map.get()` on a key that is present, a brand cast, a WASM export table. A plugin `setup()` that needs the full engine calls `asFullEngine(engine)` from `@gwenjs/core/internal`. Plugin authors can follow the same rule: type the value when you can, and mark the boundary when you cannot.

## Next Steps

- [Writing a Custom Plugin](/kit/custom-plugin) — Learn how to create runtime plugins
- [Writing a Custom Module](/kit/custom-module) — Learn how to create build-time modules
- [Composing Plugins](/kit/composing) — Combine plugins with dependencies
