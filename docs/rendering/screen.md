---
title: Screen Info
description: Access pixel dimensions, DPR, and world-space bounds for any named viewport using useScreen().
---

# Screen Info

`useScreen()` gives your game code direct access to a viewport's pixel dimensions and
world-space bounds — without coupling to `window.*` or browser APIs.

```ts
const screen = useScreen('main')

onUpdate(() => {
  // Constrain player to visible world bounds
  if (screen.bounds) {
    Position.x[id] = Math.max(screen.bounds.minX, Math.min(screen.bounds.maxX, Position.x[id]))
    Position.y[id] = Math.max(screen.bounds.minY, Math.min(screen.bounds.maxY, Position.y[id]))
  }

  // Center a UI element
  UIBox.x[uiId] = screen.pixels.width / 2
})
```

## Zero-config setup

`ScreenPlugin` is registered automatically by `@gwenjs/app` — no configuration required for browser games:

```ts
// gwen.config.ts — nothing needed
export default defineConfig({
  modules: ['@gwenjs/camera2d', '@gwenjs/renderer-html'],
})
```

In the browser, `ScreenPlugin` uses `ResizeObserver` on `document.documentElement` to detect
the container size. The dimensions update automatically on every resize.

## `useScreen(viewportId?)`

Call during the **synchronous setup phase** of `defineSystem`, `defineActor`, or `defineScene`.

```ts
const screen = useScreen()        // defaults to 'main'
const screen = useScreen('main')  // explicit viewport id
const p1     = useScreen('p1')    // split-screen player 1
```

The returned object is **stable** — the same reference is returned on every call for the same
viewport id. Its properties are mutated in place each frame. Safe to capture in closures
and async callbacks.

| Property | Type | Description | Updated |
|---|---|---|---|
| `pixels.width` | `number` | Viewport width in CSS pixels | On container resize |
| `pixels.height` | `number` | Viewport height in CSS pixels | On container resize |
| `dpr` | `number` | Device pixel ratio | On container resize |
| `bounds` | `ViewportBounds \| undefined` | World-space bounds | Every frame (via camera plugin) |

## World bounds

`bounds` is populated by the active camera plugin each frame in `engine:afterTick` (after
`CameraSystem` writes the camera state).

```ts
interface ViewportBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}
```

| Scenario | `bounds` value |
|---|---|
| Orthographic camera active (via `camera-core`) | Computed from zoom + camera position |
| No camera plugin installed | `undefined` |
| No active camera for this viewport | `undefined` |
| Perspective camera (not yet supported) | `undefined` |

## Split-screen

Each viewport gets its own `useScreen()` instance with independent pixel dimensions and bounds:

```ts
// gwen.config.ts
export default defineConfig({
  viewports: {
    p1: { x: 0,   y: 0, width: 0.5, height: 1 },
    p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
  },
})

// In a system
const Player1System = defineSystem('Player1System', () => {
  const screen = useScreen('p1')

  onUpdate(() => {
    if (screen.bounds) {
      Position.x[p1Id] = Math.max(screen.bounds.minX, Position.x[p1Id])
    }
  })
})
```

## Node.js / server

For game servers or non-browser environments, provide a `StaticSizeProvider`:

```ts
// gwen.config.ts
import { StaticSizeProvider } from '@gwenjs/renderer-core'

export default defineConfig({
  screen: {
    sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 })
  }
})
```

World bounds are still computed if a camera plugin is installed.

## Custom environment

For Electron, native WebViews, or any host that provides its own resize events:

```ts
// gwen.config.ts
export default defineConfig({
  screen: {
    sizeProvider: {
      getSize() {
        return { width: myApp.windowWidth, height: myApp.windowHeight }
      },
      subscribe(callback) {
        myApp.on('resize', callback)
        return () => myApp.off('resize', callback)
      },
    },
  },
})
```

The `subscribe` function must return a cleanup function — GWEN calls it automatically on `engine:stop`.

## Async context

`useScreen()` follows the same async-context rules as all GWEN composables.
**Call it during the synchronous setup phase** — the returned reference works anywhere:

```ts
const PlayerActor = defineActor(PlayerPrefab, () => {
  const screen = useScreen('main')  // ✅ sync setup

  onStart(async () => {
    await loadAssets()
    Position.x[id] = screen.pixels.width / 2   // ✅ stable reference
  })
})
```

See [Async Context](/advanced/async-context) for details.

## Error reference

| Code | When | Fix |
|---|---|---|
| `SCREEN:RESIZE_OBSERVER_NOT_AVAILABLE` | Browser without `ResizeObserver`, or Node.js without `sizeProvider` | Add `screen.sizeProvider` in `gwen.config.ts` |
| `SCREEN:VIEWPORT_NOT_FOUND` | `useScreen('unknown')` for an unregistered id | Check the id or declare the viewport in `gwen.config.ts` |
