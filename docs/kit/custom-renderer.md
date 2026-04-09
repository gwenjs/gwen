---
title: Building a Custom Renderer Plugin
description: How to create a GWEN renderer plugin that integrates with the LayerManager, provides composables, and passes the conformance test suite.
---

# Building a Custom Renderer Plugin

This guide walks through building a complete renderer plugin for GWEN — from
scaffolding the package to exposing composables and passing the conformance suite.

## What is a renderer plugin?

A renderer plugin connects a graphical technology (Canvas, WebGL, Three.js, a custom
2D engine…) to the GWEN engine. It:

- Implements `RendererService` from `@gwenjs/renderer-core`
- Registers itself via `engine.provide('renderer:<name>', service)`
- Manages one or more named DOM layers (each a `<canvas>` or `<div>`)
- Exposes composables (`useMyRenderer()`) that game code calls inside `defineActor`

The GWEN engine does not know about rendering at all — everything visual is a plugin.

## Prerequisites

- Read `internals-docs/renderer-system.md` for architecture context
- `@gwenjs/renderer-core` must be installed (it provides the contract)

## Step 1 — Scaffold the package

Use the GWEN CLI to generate the package structure:

```bash
pnpm dlx @gwenjs/cli scaffold package renderer-mytech
```

This generates the full package structure:

```
renderer-mytech/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── index.ts
    ├── types.ts
    ├── plugin.ts
    ├── composables.ts
    ├── augment.ts
    └── module.ts
```

Then add `@gwenjs/renderer-core` as a dependency:

```bash
cd renderer-mytech
pnpm add @gwenjs/renderer-core
```

## Step 2 — Implement the renderer service

Use `defineRendererService` to define your service. It handles contract version,
element caching, `UnknownLayerError`, and stats wiring automatically.

Create `src/mytech-renderer-service.ts`:

```ts
import { defineRendererService, type LayerDef } from '@gwenjs/renderer-core'
import { MyTechEngine } from 'mytech'

export interface MyTechRendererOptions {
  layers: Record<string, LayerDef>
}

let engine: MyTechEngine | null = null

export const MyTechRenderer = defineRendererService<MyTechRendererOptions>((opts) => ({
  name: 'renderer:mytech',
  layers: opts.layers,

  // Called once per declared layer — result is cached automatically
  createElement() {
    return document.createElement('canvas')
  },

  mount({ getLayer }) {
    const canvas = getLayer(Object.keys(opts.layers)[0]!) as HTMLCanvasElement
    engine = new MyTechEngine({ canvas })
  },

  unmount() {
    engine?.dispose()
    engine = null
  },

  resize(w, h) {
    engine?.setSize(w, h)
  },

  // Called each frame via service.flush() — stats are no-ops when disabled
  flush({ reportFrameTime }) {
    const t = performance.now()
    engine?.render()
    reportFrameTime(performance.now() - t)
  },
}))
```

## How LayerManager orchestrates mount

`defineRendererService` creates two distinct API surfaces:

| `RendererServiceDef` (what you write) | `RendererService` (what LayerManager calls) |
|---|---|
| `createElement(layerName): HTMLElement` | `getLayerElement(layerName): HTMLElement` |
| `mount(ctx: RendererMountContext): void` | `mount(container: HTMLElement): void` |

The orchestration sequence when `manager.mount()` is called:

1. **For each declared layer** — LayerManager calls `service.getLayerElement(layerName)`, which triggers your `createElement(layerName)` on first call and caches the result.
2. **DOM insertion** — LayerManager inserts each element into the container in `order` order.
3. **Mount call** — LayerManager calls `service.mount(container)`. Internally, `defineRendererService` translates this to `def.mount({ container, getLayer: (name) => elementCache.get(name) })`.
4. **Your `mount({ getLayer })` runs** — at this point, all elements are already in the DOM and fully sized.

::: tip Testing your service directly
When testing outside of LayerManager, call `service.mount(container)` with an `HTMLElement` — not `{ getLayer }`. The `getLayer` context is constructed internally by `defineRendererService`.

```ts
const service = MyTechRenderer({ layers: { main: { order: 0 } } })
const container = document.createElement('div')
document.body.appendChild(container)
service.mount(container) // ✅ correct public API
```
:::

## Step 3 — Create the GwenPlugin

Create `src/mytech-plugin.ts`:

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { getOrCreateLayerManager } from '@gwenjs/renderer-core'
import type { LayerDef } from '@gwenjs/renderer-core'
import { MyTechRenderer } from './mytech-renderer-service.js'

export interface MyTechRendererPluginOptions {
  layers: Record<string, LayerDef>
  container?: HTMLElement
}

export const MyTechRendererPlugin = definePlugin<MyTechRendererPluginOptions>((opts) => {
  const service = MyTechRenderer({ layers: opts.layers })

  return {
    name: 'renderer:mytech',
    setup(engine) {
      engine.provide('renderer:mytech', service)

      const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
      if (import.meta.env.DEV || engine.debug) {
        manager.enableStats()
      }
      manager.register(service)

      engine.hooks.hook('engine:init', () => manager.mount())
      engine.hooks.hook('engine:stop', () => manager.unregister('renderer:mytech'))
    },

    onRender() {
      service.flush()
    },
  }
})
```

## Step 4 — Expose composables

Composables are the public API for game code. Each composable:
- Retrieves the service via `useService`
- Creates the resource on the service
- Registers `onDestroy` automatically — the game dev never has to

Create `src/composables/use-mytech-object.ts`:

```ts
import { onDestroy } from '@gwenjs/core/actor'
import { useService } from '@gwenjs/core/system'

export interface MyTechObjectHandle {
  setPosition(x: number, y: number): void
  setVisible(v: boolean): void
  destroy(): void
}

/**
 * Adds a MyTech renderable object to the current actor.
 * Cleaned up automatically when the actor is destroyed.
 *
 * Must be called inside `defineActor()`.
 *
 * @example
 * ```ts
 * export const EnemyActor = defineActor(EnemyPrefab, () => {
 *   const obj = useMyTechObject()
 *   onUpdate(() => obj.setPosition(Position.x[id], Position.y[id]))
 * })
 * ```
 */
export function useMyTechObject(): MyTechObjectHandle {
  const service = useService('renderer:mytech')
  const obj = service.createObject()

  onDestroy(() => obj.destroy())

  return {
    setPosition: (x, y) => obj.setPosition(x, y),
    setVisible:  (v) => obj.setVisible(v),
    destroy:     () => obj.destroy(),
  }
}
```

::: tip No entity ID needed
The composable uses `onDestroy` (public API) for lifecycle — no internal API needed.
If you need transform sync, do it explicitly in `onUpdate` or build a higher-level composable on top.
:::

## Step 5 — Export a GwenModule

Create `src/module.ts`:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { MyTechRendererPlugin } from './mytech-plugin.js'
import type { MyTechRendererOptions } from './mytech-plugin.js'

export default defineGwenModule<MyTechRendererOptions>({
  meta: {
    name: '@gwenjs/renderer-mytech',
    configKey: 'rendererMytech',
  },
  defaults: {
    layers: { main: { order: 0 } },
  },
  setup(options, gwen) {
    gwen.addPlugin(MyTechRendererPlugin(options))
    gwen.addAutoImports([
      { name: 'useMyTech', from: '@gwenjs/renderer-mytech' },
    ])
    gwen.addModuleAugment(`
      declare module '@gwenjs/core' {
        interface GwenProvides {
          'renderer:mytech': import('@gwenjs/renderer-mytech').MyTechRendererService
        }
      }
    `)
  },
})
```

## Step 6 — Add the conformance test

```ts
// tests/conformance.test.ts
import { runConformanceTests } from '@gwenjs/renderer-core/testing'
import { MyTechRenderer } from '../src/mytech-renderer-service.js'

describe('@gwenjs/renderer-mytech conformance', () => {
  it('satisfies the RendererService contract', () => {
    const service = MyTechRenderer({ layers: { main: { order: 0 } } })
    expect(() => runConformanceTests(service)).not.toThrow()
  })
})
```

## Step 7 — Register in `gwen.config.ts`

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: [
    ['@gwenjs/renderer-mytech', {
      layers: {
        background: { order: 0  },
        game:       { order: 10 },
      }
    }],
  ]
})
```

## Required vs. optional

| RendererService member | Required | Notes |
|---|---|---|
| `name` | ✅ | Must match the `GwenProvides` key |
| `contractVersion` | ✅ | Must equal `RENDERER_CONTRACT_VERSION` |
| `layers` | ✅ | At least one entry |
| `mount()` | ✅ | Called after DOM is ready |
| `unmount()` | ✅ | Must free all resources |
| `resize()` | ✅ | Called on viewport resize |
| `getLayerElement()` | ✅ | Must throw `UnknownLayerError` for unknown names |
| `setStatsCollector()` | Optional | Implement to support devtools stats |

## Checklist before publishing

- [ ] `runConformanceTests()` passes in CI
- [ ] `pnpm typecheck` passes
- [ ] `GwenProvides` augmentation declared in `index.d.ts`
- [ ] `onDestroy` / `unmount()` releases all resources (listeners, GPU buffers, DOM nodes)
- [ ] `setStatsCollector` implemented if the renderer issues draw calls
- [ ] README includes the `gwen.config.ts` snippet
