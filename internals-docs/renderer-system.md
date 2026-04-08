# Renderer Plugin System — Internal Architecture

## Overview

The renderer plugin system provides a composable, technology-agnostic way to connect
visual output (HTML/CSS, Canvas 2D, WebGL, Three.js, R3F) to the Gwen engine.
It was designed around three constraints:

1. **Gwen does not dictate how you render.** The core engine has no opinion on
   Canvas vs WebGL vs R3F. Every renderer is an optional plugin.
2. **One renderer technology can span multiple depth layers.** A single HTML renderer
   may manage a background layer (z-index 0) and a HUD layer (z-index 100).
3. **Optimisations are encapsulated.** A developer calling `useSprite()` on 500 entities
   should not need to know about batching or GPU instancing — the plugin handles it.

## Package Dependency Graph

```
game code
   └── @gwenjs/renderer-html    → useHTML()
   └── @gwenjs/renderer-canvas  → useSprite(), useAnimation()
   └── @gwenjs/renderer-webgl   → useSprite(), useShader()
   └── @gwenjs/renderer-three   → useMesh(), useLight()
   └── @gwenjs/renderer-r3f     → useR3F(), useMesh()
         └── @gwenjs/renderer-core  (zero graphical deps)
               └── @gwenjs/core     (GwenEngine, GwenPlugin, GwenProvides)
```

`@gwenjs/renderer-core` is the only shared dependency. It contains no graphical code —
only TypeScript interfaces, `defineRendererService`, `getOrCreateLayerManager`,
`RendererStatsCollector`, and error classes.

## Key Design Decisions

### Technology ≠ Layer

A "renderer" (the technology: HTML, Canvas, WebGL…) is distinct from a "layer"
(a named depth slot with a z-index). One renderer manages N layers:

```ts
['@gwenjs/renderer-html', {
  layers: {
    background: { order: 0  },  // sky CSS animation
    bubbles:    { order: 20 },  // world-space speech bubbles
    hud:        { order: 100 }, // health bar, score
  }
}]
```

This enables HTML at z-index 0 (background) and HTML at z-index 100 (HUD) without
registering two separate plugins — which would conflict on `GwenProvides`.

### LayerManager owns DOM structure

`LayerManager` (in `renderer-core`) is the single authority over which DOM elements
exist and in what order. It:
1. Collects all layers from all registered renderers
2. Sorts them by `order`
3. Inserts `<canvas>` or `<div>` elements into the root container
4. Calls `mount()` on each renderer after DOM is ready
5. Propagates `resize()` to all renderers

Individual renderer plugins do **not** touch the DOM outside their own elements.

`LayerManager` is not part of the public API. Plugin authors obtain the shared instance
via `getOrCreateLayerManager(engine, container)`, which creates it on first call bound
to `engine.logger` and returns the same instance to every subsequent renderer plugin.

### Frame loop integration

Renderers with their own RAF loop (Three.js, R3F, PixiJS) use `engine.startExternal()`
to prevent Gwen from opening a competing RAF loop. The renderer then calls
`engine.advance(dt)` on each frame from its own loop (e.g. `useFrame` in R3F).

Renderers without their own loop (HTML, Canvas, WebGL) implement `onRender()` on
their `GwenPlugin`. Gwen calls this hook in frame phase 8 (render).

### Stats are dev/debug only

`RendererStatsCollector` is a no-op when disabled. `LayerManager` calls `enableStats()`
only when `import.meta.env.DEV || engine.debug` is true. In production builds
without debug mode, Vite tree-shakes the hot path entirely.

Stats are available at `engine.getStats().renderers` — a `RendererStats | undefined`
field injected via TypeScript declaration merging in `renderer-core/src/index.ts`.

### Validation strategy

| Violation | Moment | Response |
|---|---|---|
| Duplicate `GwenProvides` key | TypeScript build | Compile error (declaration merging) |
| Duplicate renderer name | `engine.use()` runtime | `RendererAlreadyRegisteredError` (throw) |
| Contract version mismatch | `LayerManager.register()` | `RendererContractVersionError` (throw) |
| Duplicate layer order | `LayerManager.register()` | `RENDERER:LAYER_ORDER_CONFLICT` warn |
| Unknown layer in composable | composable call | `UnknownLayerError` (throw) |
| Budget overrun | `onRender()` debug mode | `logger.verbose` |

## Error Codes

All error codes are namespaced `RENDERER:*` and exported from `@gwenjs/renderer-core`
as `RendererErrorCodes`. This mirrors the `CoreErrorCodes` pattern in `@gwenjs/core`.

## RFC Index

| RFC | Title |
|-----|-------|
| RFC-012 | Renderer Plugin System — RendererService contract, LayerManager, stats |

## Adding a New Renderer

1. Scaffold with `pnpm dlx @gwenjs/cli scaffold package renderer-<name>`
2. Use `defineRendererService(factory)` from `@gwenjs/renderer-core` — handles contract version, element caching, stats wiring automatically
3. Use `getOrCreateLayerManager(engine, container)` in the plugin's `setup()` to register with the shared `LayerManager`
4. Augment `GwenProvides` with `'renderer:<name>': ReturnType<typeof MyRenderer>`
5. Export composables (`useSprite`, `useHTML`, `useMesh`…) using `useService('renderer:<name>')` + `onDestroy` for lifecycle — no `_getActorEntityId` needed
6. Export a `defineGwenModule` default export
7. Run `runConformanceTests()` from `@gwenjs/renderer-core/testing` in your test suite

See `docs/kit/custom-renderer.md` for the step-by-step contributor guide.
