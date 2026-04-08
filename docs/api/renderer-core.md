---
title: '@gwenjs/renderer-core'
description: Type contracts, LayerManager, stats, and error codes for the GWEN renderer plugin system.
---

# `@gwenjs/renderer-core`

The zero-dependency contract package for GWEN renderer plugins. Contains the
`RendererService` interface, `LayerManager`, stats types, error classes, and
the `runConformanceTests()` utility.

Install alongside any renderer plugin — it ships as a peer dependency.

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

### `getOrCreateLayerManager()`

```ts
function getOrCreateLayerManager(engine: GwenEngine, container: HTMLElement): LayerManager
```

The entry point for renderer plugins. Returns the shared `LayerManager` for this engine,
creating it on first call. The created instance is automatically bound to `engine.logger`
so all renderer warnings flow through the engine's log sink.

```ts
// Inside a renderer plugin:
setup(engine) {
  const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
  manager.register(service)
  engine.onStart(() => manager.mount())
  engine.onDestroy(() => manager.unregister(service.name))
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
