# @gwenjs/schema

> This package is the Single Source of Truth (SSOT) for the shared GWEN contracts (`GwenRuntimeHooks`, `GwenProvides`, `GwenModuleOptions`, …).
> It is the only augmentation target for those contracts.

---

## What this package does

`@gwenjs/schema` holds the shared contracts other packages augment, plus the engine-field check `checkEngineConfig` and `ENGINE_DEFAULTS`.

| Responsibility         | What is exported                                   |
| ---------------------- | -------------------------------------------------- |
| **Helper types**       | `GwenHookHandler`, `DeepPartial`                   |
| **Hook contracts**     | `GwenRuntimeHooks`, `HookHandlerMap`, `InferHooks` |
| **Engine field check** | `ENGINE_DEFAULTS`, `checkEngineConfig`             |

User configuration is `GwenUserConfig` in `@gwenjs/app` and `resolveGwenConfig` in `@gwenjs/app/resolve`. The resolved shape is `ResolvedGwenConfig` (`### ResolvedGwenConfig` in `docs/api/app.md`). The field table is `## Config Reference` in `docs/essentials/engine.md`.

---

## Key exported types

### `GwenHookHandler`

Generic hook handler used across schema contracts.

```typescript
import type { GwenHookHandler } from "@gwenjs/schema";
```

### `DeepPartial<T>`

Utility type that makes every property in `T` recursively optional.

```typescript
import type { DeepPartial } from "@gwenjs/schema";
```

---

## Hook contracts (`GwenRuntimeHooks`)

`@gwenjs/schema` is the canonical home of the hook name → handler signature map. Plugin packages add their own hooks to `GwenRuntimeHooks` by declaration merging:

```typescript
declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "my-plugin:event": (payload: MyPayload) => void;
  }
}
```

---

## Installation

Add it to the `package.json` of any package or project that imports its types or augments its contracts. Inside the monorepo:

```jsonc
// packages/your-package/package.json
{
  "dependencies": {
    "@gwenjs/schema": "workspace:*",
  },
}
```

Then import types or runtime helpers:

```typescript
import { checkEngineConfig, ENGINE_DEFAULTS } from "@gwenjs/schema";
import type { DeepPartial, GwenHookHandler, GwenRuntimeHooks } from "@gwenjs/schema";
```

Plugin and module authors augment the shared contracts (`GwenRuntimeHooks`, `GwenProvides`, `GwenModuleOptions`, `GwenPrefabExtensions`, `GwenSceneExtensions`, `GwenUIExtensions`) with `declare module "@gwenjs/schema"` and import the shared types from `@gwenjs/schema`.

---

## One copy of @gwenjs/schema per app

`instanceof GwenError` requires one copy of `@gwenjs/schema` in the app. Do not mix `require` and `import` of the schema, and do not install two versions.

---

## Development

```bash
# Build (outputs to dist/)
pnpm build

# Watch mode
pnpm watch

# Run tests
pnpm test
```

Tests live in `tests/`.

## Public exports

### `.`

Values: `ENGINE_DEFAULTS`, `GWEN_DOCS_BASE`, `GWEN_PLUGIN_KEYS`, `GWEN_PLUGIN_LIFECYCLE_HOOKS`, `GwenError`, `RENDERER_CONTRACT_VERSION`, `RENDER_VIEW_MATRIX_LENGTH`, `TRANSFORM_2D_SERVICE`, `checkEngineConfig`, `createEntityId`, `entityGeneration`, `entityIndex`, `errorDocsAnchor`, `errorDocsUrl`, `formatReceived`, `unpackEntityId`

Types: `AutoImport`, `CameraProjection`, `CameraState`, `CameraStateStore`, `ComponentType`, `DeepPartial`, `DisposableRegistryBase`, `EngineErrorPayload`, `EngineStateChangePayload`, `EntityId`, `ForbiddenPluginKey`, `GwenBaseConfig`, `GwenBuildHooks`, `GwenConfigIssue`, `GwenDisposable`, `GwenEngineBase`, `GwenEngineConfig`, `GwenEngineState`, `GwenEngineStateChangeReason`, `GwenErrorBusBase`, `GwenErrorLevel`, `GwenErrorOptions`, `GwenErrorPayload`, `GwenErrorTarget`, `GwenHookHandler`, `GwenKit`, `GwenLogEntry`, `GwenLogLevel`, `GwenModule`, `GwenModuleDefinition`, `GwenModuleOptions`, `GwenPlugin`, `GwenPluginRequirement`, `GwenPluginRequires`, `GwenPrefabExtensions`, `GwenProvides`, `GwenRuntimeHooks`, `GwenSceneExtensions`, `GwenScopeMeta`, `GwenScopeType`, `GwenUIExtensions`, `HookBusBase`, `HookHandlerMap`, `IGwenLogProvider`, `IGwenLogger`, `IGwenScope`, `InferHooks`, `LayerDef`, `LayerHost`, `PluginDeclaration`, `PluginErrorContext`, `PluginErrorEvent`, `RenderView`, `RendererKind`, `RendererLayerStats`, `RendererRendererStats`, `RendererService`, `RendererStats`, `RendererStatsCollector`, `ScreenInfoStore`, `SurfaceRendererService`, `TransformReader2D`, `TransformRef2D`, `TransformSample2D`, `Vec3Like`, `ViewportBounds`, `ViewportBoundsProvider`, `ViewportContext`, `ViewportPixels`, `ViewportRegion`, `ViewportScreenInfo`, `ViewportStore`, `VitePlugin`, `ViteUserConfig`, `WorldTransform`

`GwenErrorOptions` — Options for a `GwenError`.

`GwenErrorTarget` — Owner of a caught failure.
