---
title: '@gwenjs/renderer-core'
description: Type contracts, LayerManager, stats, and error codes for the GWEN renderer plugin system.
---

# `@gwenjs/renderer-core`

Contract package for GWEN renderer plugins. The contract types (`RendererService`,
`LayerDef`, `CameraState`, `ScreenService`, and the host stores) are declared in
`@gwenjs/schema` and re-exported here. This package also contains `LayerManager`,
stats helpers, error classes, and the `runConformanceTests()` utility.

```ts
import type { LayerDef, RendererService } from '@gwenjs/schema'
import { RENDERER_CONTRACT_VERSION } from '@gwenjs/schema'
```

```bash
pnpm add @gwenjs/renderer-core
```

## Constants

### `RENDERER_CONTRACT_VERSION`

```ts
export const RENDERER_CONTRACT_VERSION: number
```

The current renderer contract version is **2**. Renderer plugins must set
`contractVersion = RENDERER_CONTRACT_VERSION` to pass validation.
`LayerManager` throws `RendererContractVersionError` (`RENDERER:CONTRACT_VERSION`)
on mismatch, including a v1 renderer.

## Interfaces

### `RendererService`

The interface every renderer plugin must implement. Register via
`engine.provide('renderer:<name>', service)`.

| Member | Type | Required | Description |
|---|---|---|---|
| `name` | `string` | ✅ | Unique key matching the `GwenProvides` declaration |
| `contractVersion` | `number` | ✅ | Must equal `RENDERER_CONTRACT_VERSION` |
| `layers` | `Readonly<Record<string, LayerDef>>` | ✅ | Named depth slots. Minimum 1. |
| `mount(container)` | `void` | ✅ | Called after LayerManager inserts DOM elements |
| `unmount()` | `void` | ✅ | Called on engine shutdown — release all resources |
| `resize(width, height, dpr)` | `void` | ✅ | Called on viewport resize. A two-parameter implementation stays assignable. |
| `getLayerElement(name)` | `HTMLElement` | ✅ | Returns the DOM element for a named layer. A surface renderer returns `HTMLCanvasElement`. |
| `setStatsCollector(c)` | `void` | Optional | Inject stats collector — called after mount() in debug mode |

### `LayerDef`

```ts
interface LayerDef {
  order: number
  coordinate?: 'world' | 'screen'  // default: 'screen'
  scope?: 'viewport' | 'global'    // default: 'global' when screen, 'viewport' when world
  parallax?: { readonly x: number; readonly y: number }
}
```

Declares a named rendering slot. `order` controls depth (0 = background, 100 = HUD).

| Field | Description |
|---|---|
| `coordinate` | `'screen'` (default) — CSS pixel positions. `'world'` — the renderer must project world-unit positions to screen space. |
| `scope` | `'viewport'` — the layer is instanced once per viewport and receives the camera transform. `'global'` — mounted once for the entire screen (e.g. HUD above all viewports). Defaults to `'global'` when `coordinate: 'screen'`, `'viewport'` when `coordinate: 'world'`. |

### `RendererKind`

```ts
type RendererKind = 'layers' | 'surface'
```

Omitted on `RendererService` means `'layers'` (one DOM node per layer). `'surface'`
selects `SurfaceRendererService`.

### `SurfaceRendererService`

A renderer that owns exactly one drawing surface. It extends `RendererService`.

| Member | Type | Description |
|---|---|---|
| `kind` | `'surface'` | Required. |
| `layers` | one `LayerDef` | Exactly one entry, `coordinate: 'world'`. A second layer throws `RENDERER:SURFACE_INVALID` at register. |
| `getLayerElement` | `HTMLCanvasElement` | The canvas created in `mount()` and removed in `unmount()`. |
| `renderViews(views, alpha)` | `void` | Called by `LayerManager` once per `engine:render` after that surface is mounted. `alpha` is `engine.frame.alpha` of that display frame. |

`resize(width, height, dpr)` takes CSS pixels for `width` and `height`. The canvas backing store is
`width × dpr` and `height × dpr`.

A DOM HUD (renderer-html screen layers) stacks above the surface by using a
strictly greater `order`. An equal order throws `RENDERER:LAYER_ORDER_CONFLICT`.
Order clashes that do not involve a surface layer still warn.

### `RenderView`

```ts
interface RenderView {
  viewportId: string
  eye: 'left' | 'right' | 'none'
  readonly viewMatrix: Float32Array       // length 16, column-major, world → view
  readonly projectionMatrix: Float32Array // length 16, column-major
  readonly pixelRect: { x: number; y: number; width: number; height: number } // device px
}
```

Caller-owned. Reused across frames. `eye` matches `XRViewData.eye`. Non-XR views use `'none'`.

### `writeCameraViews()`

```ts
function writeCameraViews(engine: GwenEngine, out: RenderView[]): number
```

Fills `out` from `CameraManager`, `ViewportManager`, and screen pixels. Returns how
many active cameras were seen, including slots that were not written. Does not
allocate view objects or replace the matrix buffers. A short `out`, or a slot whose
matrices are shorter than 16, is still counted and left unchanged. Size `out` and
both matrices before reading the slots. Euler `WorldTransform` rotation is YXZ, written
as a column-major view matrix. Projection aspect comes from viewport pixels.
`@gwenjs/math` `Mat4` is not used on this seam.

XR eyes are not copied. `writeCameraViews` stays non-XR. Eye matrices live in `getCameraStores(engine).matrices`.

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
import { UnknownLayerError } from '@gwenjs/renderer-core'

export const HTMLRenderer = defineRendererService<
  HTMLOptions,
  { allocateHandle(layer: string, key: string): HTMLHandle }
>((opts) => {
  const layers = buildLayerMap(opts.layers)
  return {
    name: 'renderer:html',
    layers: opts.layers,
    createElement: (name) => {
      const layer = layers.get(name)
      if (layer === undefined) throw new UnknownLayerError(name, 'renderer:html')
      return layer.element
    },
    mount: () => {},
    unmount: () => { layers.forEach((l) => l.element.remove()) },
    resize: () => {},
    extension: {
      allocateHandle(layer, key) {
        const entry = layers.get(layer)
        if (entry === undefined) throw new UnknownLayerError(layer, 'renderer:html')
        return new HTMLHandleImpl(entry, key)
      },
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

### `RenderHostPlugin(options?)`

```ts
interface RenderHostOptions {
  /** Element the renderers mount into. Defaults to `document.body`. */
  container?: HTMLElement | undefined
  /** Viewports registered at `engine:init`. Absent or empty registers a full-screen `main`. */
  viewports?: Record<string, ViewportRegion> | undefined
}

const RenderHostPlugin: (options?: RenderHostOptions) => GwenPlugin
```

The render host. The bootstrap installs it under the name `gwen:viewports`, before `gwen:screen` and
before every renderer or camera plugin. It provides `viewportManager`, `cameraManager` and `layerManager`
(declare the ones you read in `requires.services` or `requires.optional`), and owns the renderers
registered on `layerManager`:

| What | When |
|---|---|
| Registers the `viewports` option, or a full-screen `main` | `engine:init` |
| Binds the root (`container`, else `document.body`) and mounts every registered renderer once | `engine:init` |
| Mounts a renderer registered later at once and sends it the last `resize` | `layerManager.register()` after start |
| Reports a renderer whose `mount()` throws on `engine.errors`, unregisters it, mounts the others | `engine:init`, or `register()` after start |
| Calls `renderViews(views, engine.frame.alpha)` for each mounted surface | each `engine:render` |
| Enables renderer stats | `__GWEN_DEV__ && engine.debug` |
| Unmounts every renderer and removes its DOM nodes | `engine.stop()` |

With no `container` and no `document` (a Node.js engine), the host registers the viewports and mounts nothing.
`container` is an element and cannot be serialised: the host is a bootstrap plugin, never a `PluginDeclaration`.
A user project gets it from `@gwenjs/app`, which re-exports `RenderHostPlugin` and `ScreenPlugin`.

A renderer whose `mount()` throws does not fail `engine.start()`. The event on `engine.errors` has level
`error`, source `@gwenjs/renderer-core`, the thrown value as `error`, and `context.renderer` set to the
renderer name. Its code is the code of the thrown `GwenError`, else `RENDERER:MOUNT_FAILED`.

A renderer plugin only registers its service:

```ts
// Inside a renderer plugin:
setup(engine) {
  engine.inject('layerManager').register(service)
}
```

```ts
import { RenderHostPlugin, ScreenPlugin } from '@gwenjs/renderer-core'

await engine.use(RenderHostPlugin({ container: document.getElementById('game')! }))
await engine.use(ScreenPlugin())
```

### `LayerManager`

Read with `engine.inject('layerManager')`. The class is not exported: plugin authors use the `LayerHost` methods below (`register`, `unregister`, `has`, `setParallax`).

| Method | Description |
|---|---|
| `register(service)` | Validates and stores the renderer. Before the first mount it mounts nothing. After it, the renderer is mounted at once and receives the last `resize`. |
| `unregister(name)` | Calls `unmount()` and removes the DOM nodes `data-gwen-layer="<name>:…"`. An unknown name is a no-op. |
| `has(name)` | `true` when a renderer with this name is registered. |
| `setParallax(layer, factor)` | Writes `{ x, y }` onto each registered renderer's own `LayerDef` for `layer`. That object is shared by every holder. An unknown layer throws `GwenError` `RENDERER:UNKNOWN_LAYER`: no registered renderer declares it, and the hint lists the registered renderer names. A frozen `LayerDef` throws `TypeError`. |
| `resize(width, height, dpr = 1)` | Forwards the three numbers to every renderer and keeps them for a renderer registered later. An omitted `dpr` forwards `1`. Not a `LayerHost` method: `ScreenPlugin` calls it. |

### `ScreenService`

The `screenService` host. `devicePixelRatio` is `1` before any `setContainerSize` call, then the last `dpr` passed. `setContainerSize(width, height, dpr?)` leaves `devicePixelRatio` unchanged when `dpr` is omitted.

| Member | Description |
|---|---|
| `devicePixelRatio` | `1` before `setContainerSize`, then the last `dpr` argument. |
| `setContainerSize(width, height, dpr?)` | Updates the container size. `dpr` is optional. |

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

Provided by `gwen:viewports`. Declare `viewportManager` in `requires.services`
or `requires.optional`.

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

#### Reading the manager in a plugin

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export const MyRendererPlugin = definePlugin(() => ({
  name: 'renderer:my',
  requires: { services: ['viewportManager'] },
  setup(engine) {
    const viewports = engine.inject('viewportManager')
    viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })
  },
}))
```

Use `engine.inject('viewportManager')` inside `definePlugin`'s `setup(engine)`, not in systems or actors.
`RenderHostPlugin` provides the service; nothing creates it lazily.

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

Provided by `gwen:viewports`. Declare `cameraManager` in `requires.services`
or `requires.optional`.

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

#### Reading the manager in a plugin

```ts
setup(engine) {
  const cameras = engine.inject('cameraManager')
  // cameras is now available via useCameraManager() in systems/actors
}
```

Use `engine.inject('cameraManager')` inside `definePlugin`'s `setup(engine)`, not in systems or actors.
Declare `cameraManager` in `requires.services` or `requires.optional`.

---

## Screen utilities

### `screenToWorld()`

```ts
function screenToWorld(px: number, py: number, viewportId?: string): Vec3
```

Converts a screen-space pixel coordinate to a world-space position.

The center of the viewport maps exactly to the camera's world position. Pixel
offsets are scaled by the camera's `zoom` factor.

**Only orthographic cameras are supported.** For perspective cameras, use
[`screenToRay()`](#screentoway) instead — a perspective pixel maps to a ray, not
a unique world point.

| Parameter | Type | Description |
|---|---|---|
| `px` | `number` | X coordinate in pixels. Origin is the **top-left** of the viewport. |
| `py` | `number` | Y coordinate in pixels. Origin is the **top-left** of the viewport. |
| `viewportId` | `string?` | Target viewport. When omitted, the active camera with the highest priority is used. |

**Returns** `Vec3` — world-space position. For 2D orthographic cameras, `z` equals
the camera's world Z.

**Throws**

| Error | When |
|---|---|
| `UnavailableCameraError` | No active camera was found, or the given `viewportId` is not bound to any camera. |
| `ScreenToWorldPerspectiveError` | The active camera uses perspective projection. Use `screenToRay()` instead. |

::: tip When is `viewportId` needed?
In a single-viewport game you never need to pass it — the active camera is resolved
automatically. Pass `viewportId` when you have multiple viewports (split-screen,
minimap) and need to convert coordinates relative to a specific one.
:::

::: warning Inactive cameras and explicit `viewportId`
When `viewportId` is provided explicitly, the `active` flag on the camera is **not**
checked — the camera is used regardless. This is intentional: if you name a viewport,
you are requesting it directly.
:::

### `screenToRay()` <Badge type="warning" text="coming soon" />

```ts
function screenToRay(px: number, py: number, viewportId?: string): { origin: Vec3; direction: Vec3 }
```

Converts a screen-space pixel coordinate to a world-space ray for perspective cameras.
Use the returned `origin` and `direction` with `useRaycast()` from `@gwenjs/physics3d`.

::: info Why two functions?
In an orthographic projection every screen pixel maps to exactly one world point.
In a perspective projection it maps to an infinite ray — a unique point only exists
once you intersect the ray with geometry or a plane. Two functions with different
return types makes this contract explicit.
:::

---

## Error codes

```ts
const RendererErrorCodes = {
  ALREADY_REGISTERED:        'RENDERER:ALREADY_REGISTERED',
  CONTRACT_VERSION:          'RENDERER:CONTRACT_VERSION',
  UNKNOWN_LAYER:             'RENDERER:UNKNOWN_LAYER',
  LAYER_ORDER_CONFLICT:      'RENDERER:LAYER_ORDER_CONFLICT', // warn, or throw if a surface layer is involved
  MISSING_LAYER:             'RENDERER:MISSING_LAYER',
  SURFACE_INVALID:           'RENDERER:SURFACE_INVALID',
  UNAVAILABLE_CAMERA:        'RENDERER:UNAVAILABLE_CAMERA',
  SCREEN_TO_WORLD_PERSPECTIVE: 'RENDERER:SCREEN_TO_WORLD_PERSPECTIVE',
  MOUNT_FAILED:             'RENDERER:MOUNT_FAILED',
  CONFORMANCE_FAILED:       'RENDERER:CONFORMANCE_FAILED',
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

### `runSurfaceConformance(service, engine)`

Extends `runConformanceTests` for a `SurfaceRendererService`. It checks `kind`,
exactly one world layer, canvas ownership (removed after `unmount`), `resize`
applying `dpr` from the engine screen service, and `renderViews` with 0, 1, and 2
views.

### `runCameraProviderConformance(engine, { viewportId, dt? })`

Checks that the camera provider for `viewportId` wrote `CameraState` no later than
`engine:after-update`, and that the state is still present in `engine:render`.
`dt` defaults to `1 / 60`. No `cameraManager`, a missing or late write, or a state
cleared before `engine:render` rejects `RENDERER:CONFORMANCE_FAILED`.
Run it on an engine that is not started, or pass a `dt` of at least one fixed step.
