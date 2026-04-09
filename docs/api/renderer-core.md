---
title: '@gwenjs/renderer-core'
description: Type contracts, LayerManager, stats, and error codes for the GWEN renderer plugin system.
---

# `@gwenjs/renderer-core`

The zero-dependency contract package for GWEN renderer plugins. Contains the
`RendererService` interface, `LayerManager`, stats types, error classes, and
the `runConformanceTests()` utility.

```bash
pnpm add @gwenjs/renderer-core
```

## Constants

### `RENDERER_CONTRACT_VERSION`

```ts
export const RENDERER_CONTRACT_VERSION: number
```

The current renderer contract version. Renderer plugins must set
`contractVersion = RENDERER_CONTRACT_VERSION` to pass validation.
`LayerManager` throws `RendererContractVersionError` on mismatch.

## Interfaces

### `RendererService`

The interface every renderer plugin must implement. Register via
`engine.provide('renderer:<name>', service)`.

| Member | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Unique key matching the `GwenProvides` declaration |
| `contractVersion` | `number` | ✅ | Must equal `RENDERER_CONTRACT_VERSION` |
| `layers` | `Record<string, LayerDef>` | ✅ | Named depth slots. Minimum 1. |
| `mount(container)` | `void` | ✅ | Called after LayerManager inserts DOM elements |
| `unmount()` | `void` | ✅ | Called on engine shutdown — release all resources |
| `resize(w, h)` | `void` | ✅ | Called on viewport resize |
| `getLayerElement(name)` | `HTMLElement \| HTMLCanvasElement` | ✅ | Returns DOM element for named layer |
| `setStatsCollector(c)` | `void` | Optional | Inject stats collector — called after mount() in debug mode |

### `LayerDef`

```ts
interface LayerDef {
  order: number
  coordinate?: 'world' | 'screen'  // default: 'screen'
}
```

Declares a named rendering slot. `order` controls depth (0 = background, 100 = HUD).
`coordinate: 'world'` signals that the renderer projects world coordinates to screen.

### `SpriteHandle`

Returned by `useSprite()`. Controls a sprite instance bound to one entity.

| Method | Description |
|---|---|
| `play(clip, opts?)` | Play a named animation clip |
| `stop()` | Stop and hold on current frame |
| `setVisible(v)` | Show / hide without destroying |
| `setLayer(name)` | Move to a different layer at runtime |
| `destroy()` | Remove from the renderer — call in `onDestroy()` |

### `HTMLHandle`

Returned by `useHTML()`. Manages a DOM subtree for one entity.

| Method | Description |
|---|---|
| `mount(content)` | Mount JSX / template string / HTMLElement |
| `update(props)` | Pass new props to the mounted component |
| `setVisible(v)` | Show / hide the container |
| `syncWorldPosition(x, y)` | Project world coords → screen, position the element |
| `unmount()` | Remove DOM nodes — call in `onDestroy()` |

### `MeshHandle`

Returned by `useMesh()` / `useR3F()`.

| Member | Description |
|---|---|
| `node` | Renderer-specific scene node (Three.js Object3D, R3F ref…) |
| `animator` | `AnimatorHandle` for playback control |
| `setVisible(v)` | Show / hide |
| `destroy()` | Remove from scene — call in `onDestroy()` |

## Functions

### `defineRendererService()`

```ts
function defineRendererService<Options, TExtension extends object = {}>(
  factory: (opts: Options) => RendererServiceDef<TExtension>
): (opts: Options) => ManagedRendererService & TExtension
```

Ergonomic factory for `RendererService` implementations. Handles contract version,
DOM element caching, `UnknownLayerError`, and stats collector wiring automatically.

The optional `TExtension` generic lets renderer plugins expose additional methods
(e.g. `allocateHandle` for composable use) without reimplementing the full
`RendererService` boilerplate.

```ts
// Basic usage — no extension
export const MyRenderer = defineRendererService<MyOptions>((opts) => ({
  name: 'renderer:mytech',
  layers: opts.layers,
  createElement: () => document.createElement('canvas'),
  mount({ getLayer }) { /* init renderer */ },
  unmount() { /* dispose */ },
  resize(w, h) { /* resize */ },
  flush({ reportFrameTime }) { reportFrameTime(/* ms */0) },
}))

// With extension — renderer-specific methods typed on the returned service
export const HTMLRenderer = defineRendererService<
  HTMLOptions,
  { allocateHandle(layer: string, key: string): HTMLHandle }
>((opts) => {
  const layers = buildLayerMap(opts.layers)
  return {
    name: 'renderer:html',
    layers: opts.layers,
    createElement: (name) => layers.get(name)!.element,
    mount: () => {},
    unmount: () => { layers.forEach((l) => l.element.remove()) },
    resize: () => {},
    extension: {
      allocateHandle(layer, key) { return new HTMLHandleImpl(layers.get(layer)!, key) },
    },
  }
})

export type HTMLRendererService = ReturnType<typeof HTMLRenderer>
// HTMLRendererService = ManagedRendererService & { allocateHandle(...): HTMLHandle }
```

**`RendererServiceDef<TExtension>` fields**

| Field | Required | Description |
|---|---|---|
| `name` | ✅ | Unique renderer identifier |
| `layers` | ✅ | Layer declarations |
| `createElement(name)` | ✅ | Create the DOM element for one layer — result is cached |
| `mount(ctx)` | ✅ | Called after all elements are inserted |
| `unmount()` | ✅ | Must release all resources |
| `resize(w, h)` | ✅ | Called on viewport resize |
| `flush(ctx)` | Optional | Called each frame via `service.flush()` |
| `extension` | Optional | Additional methods merged into the returned service |

Contract properties (`name`, `contractVersion`, `layers`, `getLayerElement`,
`mount`, `unmount`, `resize`, `setStatsCollector`, `flush`) always take precedence
over same-named keys in `extension`.

### `getOrCreateLayerManager()`

```ts
function getOrCreateLayerManager(engine: GwenEngine, container: HTMLElement): LayerManager
```

The entry point for renderer plugins. Returns the shared `LayerManager` for this engine,
creating it on first call. On first call it also:
- Binds the manager to `engine.logger` so all renderer warnings flow through the engine's log sink.
- Registers an `engine:tick` handler that calls `manager.beginFrame()` at the start of every frame,
  keeping per-frame stats totals accurate without any plugin-side wiring.

```ts
// Inside a renderer plugin:
setup(engine) {
  const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
  manager.register(service)
  engine.hooks.hook('engine:init', () => manager.mount())
  engine.hooks.hook('engine:stop', () => manager.unregister(service.name))
}
```

The `container` argument is only used on the first call. Subsequent renderer plugins
reuse the existing instance regardless of the container they pass.

## Error codes

```ts
const RendererErrorCodes = {
  ALREADY_REGISTERED:   'RENDERER:ALREADY_REGISTERED',
  CONTRACT_VERSION:     'RENDERER:CONTRACT_VERSION',
  UNKNOWN_LAYER:        'RENDERER:UNKNOWN_LAYER',
  LAYER_ORDER_CONFLICT: 'RENDERER:LAYER_ORDER_CONFLICT',
  MISSING_LAYER:        'RENDERER:MISSING_LAYER',
}
```

## Testing utilities

Import from `@gwenjs/renderer-core/testing`:

```ts
import { runConformanceTests } from '@gwenjs/renderer-core/testing'
```

### `runConformanceTests(service)`

Validates a `RendererService` implementation against the contract. Throws a
descriptive error on the first violation. Does not call `mount()` or `unmount()`.
Run this in every renderer plugin's test suite.
