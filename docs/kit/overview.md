---
title: Plugin System Overview
description: GWEN is extended through plugins and modules via @gwenjs/kit.
---

# Plugin System Overview

GWEN ships with an ECS core and nothing else. No renderer, no input handler, no audio system, no physics engine. Everything beyond ECS is a **plugin**—and you pick only what your game needs.

The plugin system consists of two complementary mechanisms:

1. **Plugins** — Runtime extensions that hook into the engine lifecycle
2. **Modules** — Build-time extensions that configure the GWEN project

Together they allow you to extend GWEN with custom or third-party capabilities.

## Plugins vs Modules

| Aspect | Plugin | Module |
|--------|--------|--------|
| Defined with | `definePlugin()` from `@gwenjs/kit` | `defineGwenModule()` from `@gwenjs/kit` |
| Registered in | `engine.use(Plugin())` in `main.ts` | `defineConfig({ modules })` in `gwen.config.ts` |
| Execution context | Runtime (browser) | Build-time (Node.js: `gwen dev`, `gwen build`, `gwen prepare`) |
| Scope | Engine-wide lifecycle | Feature setup, configuration, code generation |
| Example | Input handling, physics simulation | Registering plugins, auto-imports, Vite extensions, type templates |
| Access | `engine` instance passed to `setup()` | `gwen` build API passed to `setup()` |

## Quick Example

### Plugin

A simple plugin that listens to keyboard events:

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  setup(engine) {
    const keys = new Set<string>()

    engine.onStart(() => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })

    // Store for access in systems (via services)
    engine.provide('input', { isKeyDown: (k: string) => keys.has(k) })
  },
}))
```

### Module

A module that sets up the Input plugin and auto-imports:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: { name: '@my-scope/input', configKey: 'input' },
  setup(options, gwen) {
    gwen.addPlugin(InputPlugin())
    gwen.addAutoImports([
      { name: 'useInput', from: '@my-scope/input' },
    ])
  },
})
```

### Register in Project

In `gwen.config.ts`:

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/input'],
})
```

In `main.ts`, register the plugin that the module provides:

```ts
import { createEngine } from '@gwenjs/core'
import { InputPlugin } from '@my-scope/input'

const engine = await createEngine()
await engine.use(InputPlugin())
await engine.start()
```

## When to Use Each

**Use a Plugin when:**
- You need to hook into the engine lifecycle (`setup`, `onStart`, `teardown`)
- You want to provide runtime services to systems
- You're implementing game logic or rendering

**Use a Module when:**
- You need to configure build-time behavior
- You're registering multiple plugins or auto-imports as a cohesive feature
- You want to extend the Vite build pipeline
- You need to generate type definitions for IDE auto-complete

## Next Steps

- [Writing a Custom Plugin](/kit/custom-plugin) — Learn how to create runtime plugins
- [Writing a Custom Module](/kit/custom-module) — Learn how to create build-time modules
- [Composing Plugins](/kit/composing) — Combine plugins with dependencies
