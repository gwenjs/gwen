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

## Step 2 — Implement `RendererService`

Create `src/mytech-renderer-service.ts`:

```ts
import {
  RENDERER_CONTRACT_VERSION,
  UnknownLayerError,
  type LayerDef,
  type RendererService,
  type RendererStatsCollector,
} from '@gwenjs/renderer-core'
import { MyTechRenderer } from 'mytech'

export class MyTechRendererService implements RendererService {
  readonly name = 'renderer:mytech'
  readonly contractVersion = RENDERER_CONTRACT_VERSION
  readonly layers: Record<string, LayerDef>

  private _renderer: MyTechRenderer | null = null
  private _statsCollector: RendererStatsCollector | null = null

  constructor(config: { layers: Record<string, LayerDef> }) {
    this.layers = config.layers
  }

  mount(container: HTMLElement): void {
    const canvas = this.getLayerElement(Object.keys(this.layers)[0]!) as HTMLCanvasElement
    this._renderer = new MyTechRenderer({ canvas })
  }

  unmount(): void {
    this._renderer?.dispose()
    this._renderer = null
  }

  resize(width: number, height: number): void {
    this._renderer?.setSize(width, height)
  }

  getLayerElement(layerName: string): HTMLCanvasElement {
    if (!(layerName in this.layers)) {
      throw new UnknownLayerError(layerName, this.name)
    }
    return document.createElement('canvas')
  }

  setStatsCollector(collector: RendererStatsCollector): void {
    this._statsCollector = collector
  }

  /** Called each frame from onRender(). Flush draw calls and report stats. */
  flush(): void {
    const start = performance.now()
    this._renderer?.render()
    const elapsed = performance.now() - start
    this._statsCollector?.reportFrameTime(elapsed)
  }
}
```

## Step 3 — Create the GwenPlugin

Create `src/mytech-plugin.ts`.

::: tip Why `getOrCreateLayerManager` instead of `new LayerManager`?
`getOrCreateLayerManager(engine, container)` is the correct way to obtain a `LayerManager` inside a plugin.
It creates the shared instance on first call — bound to the engine's logger so all renderer warnings
flow through the engine's log sink — and returns the same instance to every subsequent renderer plugin.
You never manage the singleton yourself, and you never need to know whether another renderer already
created it.
:::

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { getOrCreateLayerManager } from '@gwenjs/renderer-core'
import type { LayerDef } from '@gwenjs/renderer-core'
import { MyTechRendererService } from './mytech-renderer-service.js'

export interface MyTechRendererOptions {
  layers: Record<string, LayerDef>
  container?: HTMLElement
}

export const MyTechRendererPlugin = definePlugin<MyTechRendererOptions>((opts) => {
  const service = new MyTechRendererService({ layers: opts.layers })

  return {
    name: 'renderer:mytech',
    setup(engine) {
      engine.provide('renderer:mytech', service)

      const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
      if (import.meta.env.DEV || engine.debug) {
        manager.enableStats()
      }
      manager.register(service)

      engine.onStart(() => manager.mount())
      engine.onDestroy(() => manager.unregister('renderer:mytech'))
    },

    onRender() {
      service.flush()
    },
  }
})
```

## Step 4 — Expose composables

Create `src/composables/use-mytech.ts`:

```ts
import { useService } from '@gwenjs/core/system'
import type { MyTechRendererService } from '../mytech-renderer-service.js'

/**
 * Returns a handle to your renderer's primary layer.
 * Must be called inside defineActor() or defineSystem().
 *
 * @example
 * ```ts
 * export const MyActor = defineActor(MyPrefab, () => {
 *   const renderer = useMyTech()
 *   onStart(() => renderer.addObject(myObject))
 *   onDestroy(() => renderer.removeObject(myObject))
 * })
 * ```
 */
export function useMyTech(): MyTechRendererService {
  return useService('renderer:mytech')
}
```

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
import { MyTechRendererService } from '../src/mytech-renderer-service.js'

describe('@gwenjs/renderer-mytech conformance', () => {
  it('satisfies the RendererService contract', () => {
    const service = new MyTechRendererService({
      layers: { main: { order: 0 } },
    })
    runConformanceTests(service)
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
