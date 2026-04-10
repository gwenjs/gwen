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
  scope?: 'viewport' | 'global'    // default: 'global' when screen, 'viewport' when world
}
```

Declares a named rendering slot. `order` controls depth (0 = background, 100 = HUD).

| Field | Description |
|---|---|
| `coordinate` | `'screen'` (default) — CSS pixel positions. `'world'` — the renderer must project world-unit positions to screen space. |
| `scope` | `'viewport'` — the layer is instanced once per viewport and receives the camera transform. `'global'` — mounted once for the entire screen (e.g. HUD above all viewports). Defaults to `'global'` when `coordinate: 'screen'`, `'viewport'` when `coordinate: 'world'`. |

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

## Camera and viewport

> For a user-facing guide on declaring and managing viewports, see **[Viewports](/rendering/viewports)**.

These types, interfaces, and composables are shared between renderer plugins and
camera-aware systems. Renderer plugins read `CameraState` each frame to project
the world; game code writes `ViewportRegion`s to declare screen regions.

### Types

#### `ViewportRegion`

```ts
interface ViewportRegion {
  x: number       // left edge [0–1]
  y: number       // top edge  [0–1]
  width: number   // [0–1]
  height: number  // [0–1]
}
```

Normalised screen region. `{ x: 0, y: 0, width: 1, height: 1 }` = full screen,
`{ x: 0, y: 0, width: 0.5, height: 1 }` = left half.

#### `ViewportContext`

```ts
interface ViewportContext {
  id: string              // e.g. 'main', 'p1', 'minimap'
  region: ViewportRegion
}
```

A registered viewport — its id and current screen region. Returned by
`ViewportManager.get()` and `ViewportManager.getAll()`.

#### `WorldTransform`

```ts
interface WorldTransform {
  position: Vec3   // world-space position
  rotation: Vec3   // Euler angles in radians. 2D cameras: only z is used.
}
```

Position and orientation of a camera in world space.

#### `CameraProjection`

```ts
type CameraProjection =
  | { type: 'orthographic'; zoom: number; near: number; far: number }
  | { type: 'perspective';  fov: number;  near: number; far: number }
```

How the world is projected onto the screen. `aspect` is always derived from the
viewport pixel dimensions at render time — never stored here.

| Field | Orthographic | Perspective |
|---|---|---|
| `zoom` | World units per pixel — `1` = 1 unit/px | — |
| `fov` | — | Vertical FOV in radians |
| `near` | Near clip plane (default `-1`) | Near clip plane (default `0.1`) |
| `far` | Far clip plane (default `1`) | Far clip plane (default `1000`) |

#### `CameraState`

```ts
interface CameraState {
  worldTransform: WorldTransform
  projection: CameraProjection
  viewportId: string   // which viewport this camera is bound to
  active: boolean
  priority: number     // higher wins when multiple cameras target the same viewport
}
```

The complete camera state for one viewport. Written by `CameraSystem` (camera-core)
at the start of each frame and read by renderer plugins.

---

### `ViewportManager`

Registry of named screen regions. Emits engine hooks when viewports are added,
resized, or removed.

```ts
interface ViewportManager {
  set(id: string, region: ViewportRegion): void
  remove(id: string): void
  get(id: string): ViewportContext | undefined
  getAll(): ReadonlyMap<string, ViewportContext>
}
```

| Method | Description |
|---|---|
| `set(id, region)` | Register or update a viewport. Emits `viewport:add` on first call, `viewport:resize` on update. |
| `remove(id)` | Remove a viewport. Emits `viewport:remove`. No-op for unknown ids. |
| `get(id)` | Read a viewport context, or `undefined` if not registered. |
| `getAll()` | All registered viewports. The returned map is live — do not mutate it. |

#### `useViewportManager()`

```ts
function useViewportManager(): ViewportManager
```

Composable accessor for the shared `ViewportManager`. Call inside `defineSystem`,
`defineActor`, or `defineScene` setup functions.

Requires `CameraCorePlugin` (from `@gwenjs/camera-core`) to be installed — it
creates the manager when it registers.

```ts
import { useViewportManager } from '@gwenjs/renderer-core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

const ViewportSetupSystem = defineSystem('ViewportSetupSystem', () => {
  const viewports = useViewportManager()
  // full screen
  viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })
})

// Dynamic split-screen example
const SplitScreenSystem = defineSystem('SplitScreenSystem', () => {
  const viewports = useViewportManager()
  onUpdate(() => {
    if (player2Joined) {
      viewports.set('p1', { x: 0,   y: 0, width: 0.5, height: 1 })
      viewports.set('p2', { x: 0.5, y: 0, width: 0.5, height: 1 })
      viewports.remove('main')
    }
  })
})
```

#### `getOrCreateViewportManager(engine)`

```ts
function getOrCreateViewportManager(engine: GwenEngine): ViewportManager
```

Plugin-level factory. Returns the shared `ViewportManager` for this engine,
creating it on first call and registering it as `engine.provide('viewportManager', …)`.

Use this inside `definePlugin`'s `setup(engine)` — not in systems or actors.

```ts
import { getOrCreateViewportManager } from '@gwenjs/renderer-core'
import { definePlugin } from '@gwenjs/kit/plugin'

export const MyRendererPlugin = definePlugin<{ container: HTMLElement }>((opts) => ({
  name: 'renderer:my',
  setup(engine) {
    const viewports = getOrCreateViewportManager(engine)
    viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })
  },
}))
```

#### Viewport hooks

Declared on `GwenRuntimeHooks` by `@gwenjs/renderer-core`:

| Hook | Payload | When |
|---|---|---|
| `viewport:add` | `{ id: string, region: ViewportRegion }` | New viewport registered |
| `viewport:resize` | `{ id: string, region: ViewportRegion }` | Existing viewport's region updated |
| `viewport:remove` | `{ id: string }` | Viewport removed |

```ts
engine.hooks.hook('viewport:add', ({ id, region }) => {
  console.log(`viewport "${id}" added`, region)
})
```

---

### `CameraManager`

Per-frame camera state store. Written by `CameraSystem` at the start of each frame;
read by renderer plugins during rendering.

```ts
interface CameraManager {
  set(viewportId: string, state: CameraState): void
  get(viewportId: string): CameraState | undefined
  getAll(): ReadonlyMap<string, CameraState>
  clearFrame(): void
}
```

| Method | Description |
|---|---|
| `set(viewportId, state)` | Write camera state. Ignored if an existing state has strictly higher priority. |
| `get(viewportId)` | Read the active camera state for a viewport, or `undefined` if none. |
| `getAll()` | All current states. Live map — do not mutate. |
| `clearFrame()` | Clear all states. Called by `CameraSystem` before writing new states. |

#### `useCameraManager()`

```ts
function useCameraManager(): CameraManager
```

Composable accessor for the shared `CameraManager`. Call inside `defineSystem`,
`defineActor`, or `defineScene` setup functions.

Requires `CameraCorePlugin` (from `@gwenjs/camera-core`) to be installed.

```ts
import { useCameraManager } from '@gwenjs/renderer-core'
import { defineSystem, onRender } from '@gwenjs/core/system'

const MyRenderSystem = defineSystem('MyRenderSystem', () => {
  const cameras = useCameraManager()
  onRender(() => {
    const state = cameras.get('main')
    if (state?.active) {
      const { position, rotation } = state.worldTransform
      // apply to renderer…
    }
  })
})
```

#### `getOrCreateCameraManager(engine)`

```ts
function getOrCreateCameraManager(engine: GwenEngine): CameraManager
```

Plugin-level factory. Returns the shared `CameraManager` for this engine,
creating it on first call and registering it as `engine.provide('cameraManager', …)`.

Use this inside `definePlugin`'s `setup(engine)` — not in systems or actors.

```ts
import { getOrCreateCameraManager } from '@gwenjs/renderer-core'

setup(engine) {
  const cameras = getOrCreateCameraManager(engine)
  // cameras is now available via useCameraManager() in systems/actors
}
```

---

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
