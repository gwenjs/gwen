# `@gwenjs/renderer-core`

Contract package for Gwen renderer plugins. Zero graphical dependencies — only TypeScript interfaces, the `LayerManager`, stats utilities, and error types.

## Installation

```sh
npm install @gwenjs/renderer-core
```

## What's included

| Export                           | Description                                             |
| -------------------------------- | ------------------------------------------------------- |
| `RendererService`                | Interface every renderer plugin must implement          |
| `RENDERER_CONTRACT_VERSION`      | Version constant used for compatibility validation      |
| `LayerManager`                   | Sorts and mounts renderer DOM layers, propagates resize |
| `RendererStatsCollectorImpl`     | Ring-buffer stats collector (dev/debug only)            |
| `RendererAlreadyRegisteredError` | Thrown on duplicate renderer registration               |
| `RendererContractVersionError`   | Thrown on contract version mismatch                     |
| `UnknownLayerError`              | Thrown when accessing an undeclared layer               |

Testing utilities are available under a separate entry point:

```ts
import { runConformanceTests } from "@gwenjs/renderer-core/testing";
```

## Building a renderer plugin

A renderer plugin exports a `RendererService` and installs it into the engine via `LayerManager`.

```ts
import type { RendererService } from "@gwenjs/renderer-core";
import { RENDERER_CONTRACT_VERSION } from "@gwenjs/renderer-core";

export const canvasService: RendererService = {
  name: "renderer:canvas",
  contractVersion: RENDERER_CONTRACT_VERSION,
  layers: {
    game: { order: 10 },
  },
  mount(root) {
    /* attach canvas to root */
  },
  unmount() {
    /* cleanup */
  },
  resize(w, h) {
    /* resize canvas */
  },
  getLayerElement(layerName) {
    return canvasEl;
  },
};
```

Use `runConformanceTests` in your plugin's test suite to verify your service implements the contract correctly:

```ts
import { runConformanceTests } from "@gwenjs/renderer-core/testing";

// Throws with a descriptive message on the first violation — use inside a test:
it("satisfies the RendererService contract", () => {
  expect(() => runConformanceTests(myService)).not.toThrow();
});
```

See [`docs/kit/custom-renderer.md`](../../docs/kit/custom-renderer.md) for the full step-by-step guide.

## Layer ordering

Each layer has an `order` number. `LayerManager` sorts all layers from all registered renderers by `order` ascending and inserts their DOM elements with matching `z-index`. Lower order = further back.

```
order  0  →  background  (world space)
order 10  →  game canvas (world space)
order 100 →  HUD overlay (screen space, pointer-events: none)
```

Duplicate order values trigger a `console.warn` — they are not an error, but you should resolve conflicts.

## Stats (dev only)

Stats collection is disabled by default. Enable it via `LayerManager.enableStats()` (called by the engine in dev/debug mode):

```ts
manager.enableStats();
manager.mount();

const stats = manager.getStats();
// stats.renderers['renderer:canvas'].frameTimeMs  — scalar for this frame
// stats.totalDrawCalls                            — accumulated total draw calls
// stats.history.drawCalls[0]                      — draw calls for one frame in the 60-frame ring buffer
```
