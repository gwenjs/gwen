---
title: Errors
---

# Errors

A third argument renders `[where] what`, then `Fix: <hint>` when `hint` is set, then `See <docsUrl> (<code>)`. Two arguments keep `what`. `docsUrl` is `docsBase + "/api/errors#" + anchor`. `docsBase` is the class static `docsBase`, or `https://gwenjs.github.io/gwen`. The anchor lower-cases the code and replaces `:` and `_` with `-`.

Outside an active context, capture a handle before an `await`:

```ts
// ✅ Capture handle synchronously in factory, use as closure after await
const transform = useTransform();
onStart(async () => {
  await loadAssets();
  transform.setPosition(400, 300); // closure — context not needed
});
```

## Namespaces

| Prefix           | Owner package (repo)                             | Codes const               | docsBase                                  |
| ---------------- | ------------------------------------------------ | ------------------------- | ----------------------------------------- |
| `CORE`           | `@gwenjs/core` (gwen)                            | `CoreErrorCodes`          | `https://gwenjs.github.io/gwen`           |
| `KIT`            | `@gwenjs/kit` (gwen)                             | `KitErrorCodes`           | `https://gwenjs.github.io/gwen`           |
| `SCHEMA`         | `@gwenjs/schema` (gwen)                          | `SchemaErrorCodes`        | `https://gwenjs.github.io/gwen`           |
| `APP`            | `@gwenjs/app` (gwen)                             | `AppErrorCodes`           | `https://gwenjs.github.io/gwen`           |
| `VITE`           | `@gwenjs/vite` (gwen)                            | `ViteErrorCodes`          | `https://gwenjs.github.io/gwen`           |
| `MATH`           | `@gwenjs/math` (gwen)                            | `MathErrorCodes`          | `https://gwenjs.github.io/gwen`           |
| `PHYSICS2D`      | `@gwenjs/physics2d` (gwen)                       | `Physics2DErrorCodes`     | `https://gwenjs.github.io/gwen`           |
| `PHYSICS3D`      | `@gwenjs/physics3d` (gwen)                       | `Physics3DErrorCodes`     | `https://gwenjs.github.io/gwen`           |
| `RENDERER`       | `@gwenjs/renderer-core` (gwen)                   | `RendererErrorCodes`      | `https://gwenjs.github.io/gwen`           |
| `CAMERA`         | `@gwenjs/camera-core` (gwen)                     | `CameraErrorCodes`        | `https://gwenjs.github.io/gwen`           |
| `CONFORMANCE`    | `@gwenjs/plugin-conformance` (gwen)              | —                         | `https://gwenjs.github.io/gwen`           |
| `AUDIO`          | gwenjs/audio                                     | —                         | `https://gwenjs.github.io/audio`          |
| `ASSETS`         | gwenjs/assets                                    | —                         | `https://gwenjs.github.io/assets`         |
| `RENDERER_THREE` | `@gwenjs/renderer-three` (gwenjs/renderer-three) | `RendererThreeErrorCodes` | `https://gwenjs.github.io/renderer-three` |
| `INSPECTOR`      | `@gwenjs/inspector` (gwenjs/inspector)           | `InspectorErrorCodes`     | `https://gwenjs.github.io/inspector`      |

`RENDERER_THREE` throws `WEBGL_UNAVAILABLE`, `NOT_MOUNTED`, and `OBJECT_ALREADY_ATTACHED`. `INSPECTOR` and `CONFORMANCE` have no codes on this page.

## Reserved codes

- `CORE:INTROSPECTION_PAGE_INVALID` {#core-introspection-page-invalid}
- `CORE:PLUGIN_EXTENSION_API_MISMATCH` {#core-plugin-extension-api-mismatch}
- `APP:PLUGIN_REQUIREMENT_MISSING` {#app-plugin-requirement-missing}
- `APP:PLUGIN_REQUIREMENT_ORDER` {#app-plugin-requirement-order}
- `APP:SERVICE_PROVIDER_MISSING` {#app-service-provider-missing}

## @gwenjs/core

### CORE:OUTSIDE_ENGINE_CONTEXT {#core-outside-engine-context}

Cause. The call is outside `defineSystem()`, `defineActor()`, `defineScene()`, `plugin setup()`, or `engine.run()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_ACTOR_CONTEXT {#core-outside-actor-context}

Cause. The call is outside `defineActor()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

`useEntityId`, `useTransform`, `useChildren`, `useComponent`, `onStart`, `onDestroy`, `onRelease`, `onReset`, `onEnable`, and `onDisable` throw this code. So do the physics composables `useDynamicBody`, `useKinematicBody`, `useStaticBody`, `useShape`, `useBoxCollider`, `useSphereCollider`, `useCapsuleCollider`, `useConvexCollider`, `useMeshCollider`, `useHeightfieldCollider`, and `useCompoundCollider`.

### CORE:OUTSIDE_SYSTEM_CONTEXT {#core-outside-system-context}

Cause. The call is outside `defineSystem()` or `defineActor()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_SCENE_CONTEXT {#core-outside-scene-context}

Cause. The call is outside `defineScene()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_LAYOUT_CONTEXT {#core-outside-layout-context}

Cause. The call is outside `defineLayout()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

`placeActor`, `placeGroup`, and `placePrefab` throw this code.

### CORE:OUTSIDE_CLEANUP_CONTEXT {#core-outside-cleanup-context}

Cause. The call is outside `defineActor()`, `plugin setup()`, or `withCleanup()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

- `CORE:ACTOR_PLUGIN_NOT_READY` {#core-actor-plugin-not-ready}
- `CORE:ACTOR_NO_LIVE_INSTANCE` {#core-actor-no-live-instance}
- `CORE:ACTOR_CIRCULAR_OWNERSHIP` {#core-actor-circular-ownership}
- `CORE:INVALID_CHUNK_SIZE` {#core-invalid-chunk-size}
- `CORE:INVALID_ENTITY_ID` {#core-invalid-entity-id}
- `CORE:LAYOUT_DISPOSE_FAILED` {#core-layout-dispose-failed}
- `CORE:LAYOUT_HANDLE_NOT_SPAWNED` {#core-layout-handle-not-spawned}
- `CORE:LAYOUT_LOAD_FAILED` {#core-layout-load-failed}
- `CORE:ACTOR_POOL_EXHAUSTED` {#core-actor-pool-exhausted}
- `CORE:INVALID_COMPONENT_SCHEMA` {#core-invalid-component-schema}
- `CORE:INVALID_COMPONENT_TYPE` {#core-invalid-component-type}
- `CORE:INVALID_SCENE_ROUTE` {#core-invalid-scene-route}

## @gwenjs/kit

- `KIT:MODULE_INVALID` {#kit-module-invalid}
- `KIT:PLUGIN_SETUP_FAILED` {#kit-plugin-setup-failed}

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. Legacy `plugins`, `tsPlugins`, or `wasmPlugins` are set and `modules` is empty. Fix. Declare at least one `modules` entry.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. A resolved option is outside the range or shape `validateResolvedConfig` checks. Fix. Use a value the message names. `targetFPS` is from 30 to 240.

## @gwenjs/app

### APP:MODULE_SETUP_FAILED {#app-module-setup-failed}

Cause. A module `setup()` threw. The `cause` is that throw. Fix. Read the cause message and fix the module setup.

### APP:MODULE_LOAD_FAILED {#app-module-load-failed}

Cause. The module package or file could not be imported, the import has no `setup()` (the `cause` is `KIT:MODULE_INVALID`), or a custom `moduleLoader` threw. Fix. Check the name and that the package is installed. In development a missing package says to run `gwen add <name>`.

### APP:CONFIG_LOAD_FAILED {#app-config-load-failed}

Cause. No `gwen.config.ts` (or `.js` / `.mjs` / `.cjs`) was found, or the file threw while loading. Fix. Add the config file, or fix the syntax error named in the message. When the file threw, `cause` is that error.

## @gwenjs/vite

### VITE:WASM_NOT_FOUND {#vite-wasm-not-found}

Cause. The WASM binary is not at the path the plugin resolved. Fix. Run `cargo build --target wasm32-unknown-unknown` first.

### VITE:OPTIMIZER_UNKNOWN_COMPONENT {#vite-optimizer-unknown-component}

Cause. The code generator was asked for a component the manifest does not contain. Fix. Register the component before generating bulk code.

### VITE:OPTIMIZER_UNKNOWN_FIELD {#vite-optimizer-unknown-field}

Cause. The field is not on that component in the manifest. Fix. Use a field that the component manifest lists.

## @gwenjs/math

### MATH:INVALID_HEX_COLOR {#math-invalid-hex-color}

Cause. `colorFromHex` received a string that is not `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Fix. Use one of those forms.

## @gwenjs/physics2d

## @gwenjs/physics3d

## @gwenjs/renderer-core

### RENDERER:ALREADY_REGISTERED {#renderer-already-registered}

Cause. A renderer name is already registered. Fix. Remove the duplicate module entry in `gwen.config.ts`.

### RENDERER:CONTRACT_VERSION {#renderer-contract-version}

Cause. `contractVersion` does not match `RENDERER_CONTRACT_VERSION`. Fix. Update the renderer plugin or `@gwenjs/renderer-core` so the versions match.

### RENDERER:UNKNOWN_LAYER {#renderer-unknown-layer}

Cause. A layer name is not declared on the renderer. Fix. Declare that layer in the renderer config.

### RENDERER:LAYER_ORDER_CONFLICT {#renderer-layer-order-conflict}

Cause. A surface layer shares its order with another layer. Fix. Give the HUD a strictly greater order.

### RENDERER:MISSING_LAYER {#renderer-missing-layer}

Cause. A renderer declared zero layers. Fix. Add at least one layer.

### RENDERER:SURFACE_INVALID {#renderer-surface-invalid}

Cause. A surface renderer does not declare exactly one world layer. Fix. Use one layer with `coordinate: "world"`.

### RENDERER:UNAVAILABLE_CAMERA {#renderer-unavailable-camera}

Cause. No active camera was found for the viewport. Fix. Add a `Camera` with `active: true` and register `CameraSystem`.

### RENDERER:SCREEN_TO_WORLD_PERSPECTIVE {#renderer-screen-to-world-perspective}

Cause. `screenToWorld` was called with a perspective camera. Fix. Use `screenToRay()`.

### RENDERER:FOREIGN_LAYER_MANAGER {#renderer-foreign-layer-manager}

Cause. `getOrCreateLayerManager` found a `layerManager` value that is not this package's `LayerManager`. Fix. Remove that value and let `getOrCreateLayerManager` create the manager, or provide the `LayerManager` it created.

### RENDERER:CONFORMANCE_FAILED {#renderer-conformance-failed}

Cause. A renderer service failed `runConformanceTests` or `runSurfaceConformance`. Fix. Update the renderer plugin to the `RendererService` contract.

### RENDERER:SCREEN_RESIZE_OBSERVER_NOT_AVAILABLE {#renderer-screen-resize-observer-not-available}

Cause. `ResizeObserver` is missing and no `sizeProvider` was set. Fix. Pass `screen.sizeProvider` in `gwen.config.ts`.

### RENDERER:SCREEN_VIEWPORT_NOT_FOUND {#renderer-screen-viewport-not-found}

Cause. The viewport id is not registered. Fix. Declare it under `viewports` in `gwen.config.ts`.

## @gwenjs/camera-core

### CAMERA:VIEWPORT_NOT_FOUND {#camera-viewport-not-found}

Cause. The viewport id is not registered. Fix. Declare it in `defineConfig` viewports, or call `useViewportManager().set()`.

Declared for camera consumers. camera-core never throws it (`packages/camera-core/src/errors.ts`).

### CAMERA:EMPTY_PATH {#camera-empty-path}

Cause. `playPath()` was called with no waypoints. Fix. Pass a non-empty waypoints array.

### CAMERA:PERSPECTIVE_FALLBACK {#camera-perspective-fallback}

Warn only. Declared on `CameraErrorCodes` and never thrown (`packages/camera-core/src/errors.ts`).

### CAMERA:PRIORITY_CONFLICT {#camera-priority-conflict}

Warn only. Declared on `CameraErrorCodes` and never thrown (`packages/camera-core/src/errors.ts`).
