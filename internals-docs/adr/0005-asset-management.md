# ADR-0005 — Asset management lives in `@gwenjs/assets`; core owns the preload seam

Contributor note. Not an end-user guide.

## Status

Accepted. 2026-10-24. Owner: Jonathan Moutier.

This record fixes the owner and the core contract. It implements neither. The contract source is the #83 body, section Technical spec. Core adds the seam in #116.

## Context

The framework has no notion of assets: no loading, no preloading, no progress, no cache, no scene-level declaration. Where this lives was undecided. Leaving it to each renderer or to each game fragments the experience.

Today a game loads assets inside `onEnter`. The docs show a user-written `await loadAssets()` (`docs/advanced/async-context.md:15`, `:44`). That call runs late. `send()` runs the leave hooks, then switches the state, then fires `scene:enter` (`packages/core/src/router/uses/use-scene-router.ts:165`, `:170`, `:172-177`, `:180`, `:184`). A slow or throwing `onEnter` therefore runs after the previous scene has left. No step of the normal transition is a preload (`packages/core/src/router/uses/use-scene-router.ts:162-178`). An overlay push fires no leave hook (`:141-143`). An overlay dismiss fires the leave hooks (`:144-161`).

Core exports no preload call. `./scene` stops at `useSystem`, `onEnter`, `onExit` and the two transition callbacks (`packages/core/src/scene/index.ts:19-25`). The async-context transform covers only `onEnter`, `onExit` and `withAsyncContext` (`packages/vite/src/plugins/async-context.ts:23`).

The initial scene is not activated by the router. The generated bootstrap does it (`packages/core/src/router/uses/use-scene-router.ts:102-105`, `packages/vite/src/entry-gen.ts:500`, `:507-509`).

Renderers load nothing. `RendererService` has no load method (`packages/renderer-core/src/types.ts:101-146`). physics3d already loads its own BVH files, with a cache that is per engine through `createEngineLocal` (`packages/physics3d/src/plugin/bvh.ts:9-12`). `preloadMeshCollider` is in the same file (`packages/physics3d/src/plugin/bvh.ts:163-215`).

Core is the ECS and nothing else (`docs/kit/overview.md:8`).

## Decision

**B.** An official plugin, `@gwenjs/assets`, on top of a minimal core preload seam.

- Core owns only the scene preload seam: when to wait, what to report, what a failure does. It adds no loader, no cache, no `Image`, no `Audio`, no `fetch`.
- `@gwenjs/assets` owns the loaders, the cache and the typed handles. Its error prefix is `ASSETS:`.
- `@gwenjs/assets` lives in its own repository, `gwenjs/assets`. The maintainer decided this on 2026-10-20. It supersedes the `packages/assets` location written in the #83 body.
- `onEnter` is unchanged.
- Preload is sequential. It runs before the leave sequence. A game declares what to load with `onPreload` in the scene factory. A plugin composable called there registers through the same seam.
- There is no `RouteConfig.loading` in v1.0. A loading screen is the current scene, a layout, or HTML that listens to `scene:preload:progress`. Core pushes no loading route and adds no engine state.
- While a preload is pending, `send()` is ignored through the existing warn path of the router. The #83 body decides this (Q1). #116 adds the guard.

**Renderers.** A renderer may load assets on its own. This is permitted and it raises no error. Such loads do not delay `scene:enter`. They do not appear in `scene:preload:progress`. They are not in progress as far as core can tell. To take part in the preload, a renderer handles `scene:preload` or calls `onPreload` from a scene composable. Core does not add a lifecycle method such as `preload()` to `RendererService` or to plugin objects.

**Test scenarios of #83.**

- A scene declares its assets with `onPreload`. Loading and progress reach the developer through `ScenePreloadEvent.progress` and the hook `scene:preload:progress` (see Core contract).
- A renderer that ignores the contract is permitted. Its loads are outside the preload (paragraph above).

## Core contract

Core adds the seams below in #116. The names, the code and the shapes are exact. This list is the contract. No behaviour is implemented by this record.

### `onPreload`

```ts
// @gwenjs/core/scene
onPreload(cb: (event: ScenePreloadEvent) => void | Promise<void>): void
SceneDefinition.onPreload?: readonly ((event: ScenePreloadEvent) => void | Promise<void>)[]
```

- Valid only in a scene factory. Elsewhere it will throw `GwenContextError` with code `CORE:OUTSIDE_SCENE_CONTEXT`, composable `"onPreload"`. The #83 body names this code `SCENE_SETUP_ONLY` before #64; the form given here is the final one.
- Several calls accumulate. `onEnter` overwrites; `onPreload` does not. `@gwenjs/assets` and user code can both register.
- It is wired like `onEnter` through `SceneHookRegistry`: a `scene:preload` handler filtered on `payload.to === name`, with the engine context set. Its `removeHook` is recorded on dispose.
- `SceneDefinition.onPreload` is optional and additive.

### `ScenePreloadEvent`

```ts
ScenePreloadEvent {
  from: GwenSceneName | null   // null on initial activation
  to: GwenSceneName
  progress(task: string, loaded: number, total: number): void
}
```

`progress` is per task. It is ignored after the preload settles, and when `total <= 0`.

### Hooks

Declared next to the existing `scene:*` hooks.

```ts
GwenRuntimeHooks["scene:preload"]: (event: ScenePreloadEvent) => void | Promise<void>
GwenRuntimeHooks["scene:preload:progress"]: (payload: { from: GwenSceneName | null; to: GwenSceneName; progress: number }) => void
```

- `scene:preload` handlers run in parallel and are awaited together.
- Progress is `Σloaded/Σtotal` over the task keys. It is clamped to [0, 1]. It never decreases. `0` is emitted first and `1` is emitted last, after every handler has resolved. With no task report, only `0` and `1` are emitted.

### `GwenScenePreloadError`

```ts
class GwenScenePreloadError extends GwenError {
  readonly code: "CORE:SCENE_PRELOAD_FAILED"
  readonly scene: GwenSceneName
  readonly from: GwenSceneName | null
}
```

`cause` is the first rejection. The code is `CORE:SCENE_PRELOAD_FAILED`, exactly. The `GwenError` base sets `code`; #116 does not redeclare it. The class is exported from `@gwenjs/core`.

### `runScenePreload`

`runScenePreload(engine, from, to)` is the function that emits the progress, awaits `scene:preload` and throws `GwenScenePreloadError` on a rejection. #116 adds it and exports it from `@gwenjs/core/internal` only. The router and the bootstrap both call it.

### Router and bootstrap behaviour

- **Order.** `send()` to any target runs and awaits the preload of the target first. Only then does the existing sequence run, from the leave hooks, unchanged. The preload runs and is awaited before the leave sequence.
- **Current scene.** During the preload the current scene keeps running. It can draw a loading UI. Its systems pause only on `scene:beforeLeave`.
- **Overlay.** An overlay dismiss runs no preload. An overlay push preloads.
- **Failure.** `send()` rejects with `GwenScenePreloadError`. `current`, `params` and the overlay stack are unchanged. No leave or enter `scene:*` hook fires. `onTransition` listeners are not called. Progress `1` is not emitted. The failure is also emitted on `engine.errors` at level `warning`. Core does not isolate, fault or stop the engine.
- **Initial activation.** The bootstrap awaits `scene:preload` for the main scene before its `scene:enter` and before `engine.start()` (`packages/vite/src/entry-gen.ts:500`, `:507-509`). A failure rejects `bootstrap()` and reaches the existing fatal display.
- **HMR.** The scene HMR swap (#78) swaps `onPreload` handlers with the other scene hooks. A preload does not re-run for the active scene.

### Guardrails for #116

- No loader, no cache, no `Image`, `Audio` or `fetch` in core. Core only awaits and reports.
- No `currentState` assignment and no leave hook before the preload resolves.
- No lifecycle method on plugin or `RendererService` objects. Participation is only `scene:preload` and `onPreload`.
- Every `scene:preload` handler has a matching `removeHook` in `SceneHookRegistry`.
- No unprefixed code. Core uses `CORE:SCENE_PRELOAD_FAILED`. `@gwenjs/assets` uses `ASSETS:`.
- No required member on `SceneDefinition`, `SceneRouterHandle` or `RendererService`.
- No `import(` and no glob in the generated bootstrap.

## Interaction with #68

- Asset bytes never sit in JS chunks. `?url` and `new URL(…, import.meta.url)` emit hashed files, and `onPreload` fetches the string. This is the same rule as `.wasm`.
- A dynamic `import()` of a data file inside `onPreload` creates a Rollup chunk, and `import.meta.glob` with `query: "?url"` is allowed in user code. #68 forbids globs only over the core WASM files and plugin packages. The "no `import(`" guardrail covers only the generated bootstrap.
- Whole-scene JS chunks are not needed. The seam has no variant branch and no DOM type, so it works in the `light` variant and in headless Node.

## Consequences

**Core and tooling**

- `@gwenjs/core/scene` gains `onPreload`, `SceneDefinition.onPreload`, the hooks `scene:preload` and `scene:preload:progress`, and a router preload phase. `@gwenjs/core` gains `GwenScenePreloadError`.
- `send()` can reject with `GwenScenePreloadError`. A preload phase is inserted before leave. This is a breaking change of behaviour, and #116 flags it. All other types are additive.
- The Vite plugin: the bootstrap awaits the main scene's preload. `onPreload` joins the async-context name list (`packages/vite/src/plugins/async-context.ts:23`).
- `@gwenjs/assets` is a new package with an `ASSETS:` row planned for the error-code prefix table.

**Renderers and docs**

- `RendererService` does not change.
- Docs: the `loadAssets()` examples move to `onPreload` (`docs/advanced/async-context.md:15`, `:44`).
- physics3d keeps its per-engine BVH cache. Its `preloadMeshCollider` is documented under `onPreload`.

**Cost**

- Core pays one composable, three hook types and one error class. It pays no loader and no DOM type, so no variant budget grows.
- The plugin owns its cache, so core does not own cache invalidation in the HMR scene swap.

**Not in this change**

- Any implementation: `@gwenjs/assets`, loaders, caching, streaming.
- Cancellation, timeouts and retries of a preload.
- Lazy WASM variants and router hot-swap.

## Rejected

- **A — core owns a generic asset registry.** Loaders would ship in every app, including `light` and headless Node where `Image` and `Audio` do not exist. Core would also own cache invalidation in the HMR scene swap, and it would contradict "ECS core and nothing else" (`docs/kit/overview.md:8`).
- **C — each renderer loads its own assets.** Games keep awaiting in `onEnter`, after the previous scene has left. There is no shared loading phase or progress, audio and data have no renderer, and physics3d would be a third cache. This is the fragmentation the ticket rejects.

## Follow-ups

| Work item | Issue | State |
| --- | --- | --- |
| Core preload seam — the Core contract above | #116 | exists |
| Double initial `onEnter` | #117 | merged |
| `@gwenjs/assets` official plugin in `gwenjs/assets`: typed handles, per-engine cache through `EngineLocal`, image, audio and JSON loaders, `ASSETS:` prefix, progress through `ScenePreloadEvent.progress` | TBD | to create |
| Renderer asset consumption: `useSprite` and texture input accept `AssetRef<"image">` from the assets contract in the `@gwenjs/schema` root and read values with `requires: { optional: ["assets"] }`. A renderer never imports `@gwenjs/assets` (binding D3, 2026-10-21) | TBD | to create |
| `preloadMeshCollider` under `onPreload`, and the docs migration from `loadAssets()` to `onPreload` (`?url`, `import.meta.glob`, `import()` inside `onPreload`) | TBD | to create |

The maintainer creates the three `TBD` items. This ADR is `Part of #83`.
