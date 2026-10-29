---
title: Errors
---

# Errors

A `GwenError` renders `[where] what`, then `Fix: <hint>` when `hint` is set, then `See <docsUrl> (<code>)`. Two arguments use `GWEN` as where. `docsUrl` is `docsBase + "/api/errors#" + anchor`. `docsBase` is the class static `docsBase`, or `https://gwenjs.github.io/gwen`. The anchor lower-cases the code and replaces `:` and `_` with `-`.

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
- `CORE:FRAME_LOOP_ERROR` {#core-frame-loop-error}
- `CORE:PLUGIN_SETUP_ERROR` {#core-plugin-setup-error}
- `CORE:PLUGIN_RUNTIME_ERROR` {#core-plugin-runtime-error}
- `CORE:WASM_LOAD_ERROR` {#core-wasm-load-error}
- `CORE:WASM_TIMEOUT` {#core-wasm-timeout}
- `CORE:WASM_PANIC` {#core-wasm-panic}
- `CORE:QUERY_CAPACITY_EXCEEDED` {#core-query-capacity-exceeded}
- `CORE:ENTITY_LIMIT_REACHED` {#core-entity-limit-reached}
- `CORE:COMPONENT_TYPE_LIMIT_REACHED` {#core-component-type-limit-reached}
- `CORE:COMPONENT_TYPE_IN_USE` {#core-component-type-in-use} — component type {type_id} still has rows
- `CORE:INVALID_PARENT` {#core-invalid-parent}
- `CORE:INVALID_MAX_ENTITIES` {#core-invalid-max-entities}
- `CORE:BUFFER_LENGTH_MISMATCH` {#core-buffer-length-mismatch}
- `CORE:WASM_MODULE_REGION_TOO_SMALL` {#core-wasm-module-region-too-small}
- `CORE:WASM_MODULE_REGION_INVALID` {#core-wasm-module-region-invalid}
- `CORE:INVALID_SHARED_BUFFER` {#core-invalid-shared-buffer}
- `CORE:COMPONENT_WRITE_REJECTED` {#core-component-write-rejected}
- `CORE:UNCAUGHT_ERROR` {#core-uncaught-error}
- `CORE:UNHANDLED_REJECTION` {#core-unhandled-rejection}
- `CORE:ERROR_HANDLER_FAILED` {#core-error-handler-failed}
- `CORE:MEMORY_VIEW_INVALID` {#core-memory-view-invalid}
- `CORE:MEMORY_VIEW_DETACHED` {#core-memory-view-detached}
- `CORE:WASM_NOT_INITIALIZED` {#core-wasm-not-initialized}
- `CORE:WASM_VARIANT_MISMATCH` {#core-wasm-variant-mismatch}
- `CORE:SHARED_BUFFER_ALLOC_FAILED` {#core-shared-buffer-alloc-failed}
- `CORE:SHARED_MEMORY_INVALID_SIZE` {#core-shared-memory-invalid-size}
- `CORE:SHARED_MEMORY_EXHAUSTED` {#core-shared-memory-exhausted}
- `CORE:SHARED_MEMORY_SENTINEL_OVERWRITE` {#core-shared-memory-sentinel-overwrite}
- `CORE:WASM_MODULE_ABI_MISMATCH` {#core-wasm-module-abi-mismatch}
- `CORE:ADVANCE_REENTRANT` {#core-advance-reentrant}
- `CORE:INVALID_STATE_TRANSITION` {#core-invalid-state-transition}
- `CORE:WASM_MODULE_NO_MEMORY` {#core-wasm-module-no-memory}
- `CORE:WASM_REGION_NOT_FOUND` {#core-wasm-region-not-found}
- `CORE:WASM_CHANNEL_NOT_FOUND` {#core-wasm-channel-not-found}
- `CORE:WASM_MODULE_NOT_FOUND` {#core-wasm-module-not-found}
- `CORE:COMPONENT_LAYOUT_INVALID` {#core-component-layout-invalid}
- `CORE:ARCHETYPE_LIMIT_REACHED` {#core-archetype-limit-reached}
- `CORE:QUERY_INVALID` {#core-query-invalid}
- `CORE:QUERY_PER_ENTITY_PATH` {#core-query-per-entity-path}
- `CORE:STORAGE_INCONSISTENT` {#core-storage-inconsistent}
- `CORE:INVALID_CONFIG` {#core-invalid-config}
- `CORE:PLUGIN_NOT_FOUND` {#core-plugin-not-found}
- `CORE:PLUGIN_DEPENDENCY_MISSING` {#core-plugin-dependency-missing} `engine.use` rejected because a required plugin or service is not installed.
- `CORE:PLUGIN_IN_USE` {#core-plugin-in-use} `engine.unuse` rejected because an installed plugin still requires this plugin or one of its services.
- `CORE:TWEEN_POOL_EXHAUSTED` {#core-tween-pool-exhausted}
- `CORE:WASM_GLUE_MISMATCH` {#core-wasm-glue-mismatch} `checkGwenModule` rejects a compiled module that does not match its glue. The engine does not call the check yet (#263).

  | `reason` | Meaning | `expected` | `actual` |
  | --- | --- | --- | --- |
  | `build` | Build ids differ, or `gwen.build` is absent or repeated. | Glue `buildId`. | Section text, `<no gwen.build section>`, or `<n gwen.build sections>`. |
  | `fingerprint` | Fingerprints differ, or `gwen.fingerprint` is absent or repeated. | Glue fingerprint. | Section text, `<no gwen.fingerprint section>`, or `<n gwen.fingerprint sections>`. |
  | `exports` | A glue `rawExports` name is not a module export. | Missing names joined by `,`. | `<absent>` |
  | `imports` | The module imports a name the contract does not list. | `<not in contract>` | Those names joined by `,`. |
- `CORE:ENGINE_DISPOSED` {#core-engine-disposed} Thrown by `createEngineLocal().get()` when it would create a value after `engine.stop()` began disposing, and by `WasmBridgeImpl` after `engine.stop()`.
- `CORE:WASM_CAPACITY_EXHAUSTED` {#core-wasm-capacity-exhausted} Thrown by WASM instance capacity (#263).
- `CORE:INVALID_ENGINE` {#core-invalid-engine} Thrown by `createEngineLocal().get()` when the argument is not an engine.
- `CORE:ENGINE_LOCAL_REENTRANT` {#core-engine-local-reentrant} Thrown by `createEngineLocal().get()` when `init` reads the same local for the engine it is building.

## @gwenjs/kit

- `KIT:MODULE_INVALID` {#kit-module-invalid}
- `KIT:PLUGIN_SETUP_FAILED` {#kit-plugin-setup-failed}

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. Nothing in @gwenjs/schema throws this code. The check left with assertModuleFirstInput. Fix. Declare modules in gwen.config.ts. A bad entry is APP:CONFIG_INVALID from `resolveGwenConfig` in `@gwenjs/app/resolve`.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. Nothing in @gwenjs/schema throws this code. The check left with validateResolvedConfig. Fix. A range error in gwen.config.ts is APP:CONFIG_INVALID from `resolveGwenConfig` in `@gwenjs/app/resolve`. The createEngine path is CORE:INVALID_CONFIG.

## @gwenjs/app

### APP:MODULE_SETUP_FAILED {#app-module-setup-failed}

Cause. A module `setup()` threw. The `cause` is that throw. Fix. Read the cause message and fix the module setup.

### APP:MODULE_LOAD_FAILED {#app-module-load-failed}

Cause. The module package or file could not be imported, the import has no `setup()` (the `cause` is `KIT:MODULE_INVALID`), or a custom `moduleLoader` threw. Fix. Check the name and that the package is installed. In development a missing package says to run `gwen add <name>`.

### APP:CONFIG_LOAD_FAILED {#app-config-load-failed}

Cause. No `gwen.config.ts` (or `.js` / `.mjs` / `.cjs`) was found, or the file threw while loading. Fix. Add the config file, or fix the syntax error named in the message. When the file threw, `cause` is that error.

### APP:CONFIG_INVALID {#app-config-invalid}

Cause. A field does not match the expected shape. `resolveGwenConfig` reports an engine field, a non-object `engine` or `logger`, a tuple module entry, and a variant shape. `GwenApp.setupModules` reports an unknown top-level key, a module section that is not an object, a `validate` issue, and a value that is not JSON-serializable, including a cycle or `undefined` in an array. The message names the path, the expected shape, and the received value. An empty config path renders `Invalid gwen.config:` with no parentheses. Fix. Use a value the message names.

### APP:CONFIG_CONFLICT {#app-config-conflict}

Cause. An explicit `engine.variant` contradicts a physics module (`resolveGwenConfig`), two modules share one `configKey`, or a `configKey` is reserved (`GwenApp.setupModules`). The message names both sides. Fix. Keep one owner, or set `engine.variant` to the variant derived from the modules.

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

### PHYSICS2D:STALE_ENTITY {#physics2d-stale-entity}

Cause. The entity is not alive. Fix. Create it again before the call.

### PHYSICS2D:STALE_BODY_HANDLE {#physics2d-stale-body-handle}

Cause. The body handle has no owner. Fix. Add the body before the collider.

### PHYSICS2D:INVALID_LAYERS {#physics2d-invalid-layers}

Cause. A layer bit is invalid or more than 32 layers are set. Fix. Use bits 0 to 31.

### PHYSICS2D:UNKNOWN_LAYER {#physics2d-unknown-layer}

Cause. The layer name is not declared. Fix. Add it to Physics2DConfig.layers.

### PHYSICS2D:INVALID_COLLIDER {#physics2d-invalid-collider}

Cause. A prefab collider lacks radius, size, or a known shape. Fix. Pass those fields.

### PHYSICS2D:WASM_VARIANT_MISMATCH {#physics2d-wasm-variant-mismatch}

Cause. The core WASM build has no physics. Fix. Load a variant that includes it.

### PHYSICS2D:INVALID_PREFAB_EXTENSION {#physics2d-invalid-prefab-extension}

Cause. The prefab extension has no colliders array. Fix. Set extensions.physics.colliders.

### PHYSICS2D:POSITION_COMPONENT_REQUIRED {#physics2d-position-component-required}

Cause. positionComponent was omitted. Fix. Pass it to createPhysicsKinematicSyncSystem.

### PHYSICS2D:NOT_INITIALIZED {#physics2d-not-initialized}

Cause. An export ran before physics_init. Fix. Set up the physics2d plugin first.

### PHYSICS2D:BODY_NOT_FOUND {#physics2d-body-not-found}

Cause. No rigid body is registered for the slot. Fix. Add a body before the call.

### PHYSICS2D:BODY_ALREADY_EXISTS {#physics2d-body-already-exists}

Cause. The slot already has a rigid body. Fix. Remove it before adding another.

### PHYSICS2D:INVALID_BODY_KIND {#physics2d-invalid-body-kind}

Cause. Body kind is not 0, 1, or 2. Fix. Use fixed, dynamic, or kinematic.

### PHYSICS2D:BUFFER_LENGTH_MISMATCH {#physics2d-buffer-length-mismatch}

Cause. Parallel bulk slices differ in length. Fix. Pass equal-length buffers.

### PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED {#physics2d-tilemap-chunk-already-loaded}

Cause. That tilemap chunk id is already loaded. Fix. Unload it before loading again.

### PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED {#physics2d-tilemap-chunk-not-loaded}

Cause. That tilemap chunk id is not loaded. Fix. Load it before unloading.

### PHYSICS2D:INVALID_PATH_REQUEST {#physics2d-invalid-path-request}

Cause. A path coordinate or distance is out of bounds. Fix. Send a finite in-range request.

### PHYSICS2D:INVALID_QUERY {#physics2d-invalid-query}

Cause. A query coordinate or radius is not accepted. Fix. Use a finite in-range value.

### PHYSICS2D:INVALID_STEP_DELTA {#physics2d-invalid-step-delta}

Cause. A step delta is not finite or is outside 0 to 1. Fix. Pass a delta in that range.

## @gwenjs/physics3d

### PHYSICS3D:BVH_WORKER_TIMEOUT {#physics3d-bvh-worker-timeout}

Cause. The BVH worker did not respond in time. Fix. Retry or use a smaller mesh.

### PHYSICS3D:BVH_CALLBACK_HANG {#physics3d-bvh-callback-hang}

Cause. The code is declared and this package does not throw it. Fix. A late worker uses BVH_WORKER_TIMEOUT.

### PHYSICS3D:MESH_FALLBACK {#physics3d-mesh-fallback}

Cause. The warning is logged without this code: a local mesh falls back to a box. Fix. Use a WASM build.

### PHYSICS3D:CONVEX_FALLBACK {#physics3d-convex-fallback}

Cause. The warning is logged without this code: a local convex hull falls back to a box. Fix. Use WASM.

### PHYSICS3D:STALE_ENTITY {#physics3d-stale-entity}

Cause. The entity is not alive. Fix. Create it again before the call.

### PHYSICS3D:UNKNOWN_LAYER {#physics3d-unknown-layer}

Cause. The layer name is not in the registry. Fix. Declare it before resolving bits.

### PHYSICS3D:INVALID_COMPOUND {#physics3d-invalid-compound}

Cause. Shape ids differ in length, a shape was not inserted, the Rust buffer length is not a multiple of 12, or a part has an unknown shape type. Fix. Match the lengths.

### PHYSICS3D:BVH_LOAD_FAILED {#physics3d-bvh-load-failed}

Cause. The BVH fetch, worker, or export failed. Rust also rejects a short buffer, a magic other than GBVH, another Rapier version, or a payload that is not a valid mesh. Fix. Check the URL, worker, and WASM build.

### PHYSICS3D:NOT_INITIALIZED {#physics3d-not-initialized}

Cause. step() ran before the plugin initialized. Fix. Call setup before step.

### PHYSICS3D:WASM_VARIANT_MISMATCH {#physics3d-wasm-variant-mismatch}

Cause. The active variant is not physics3d, or init is missing. Fix. Pass variant physics3d.

### PHYSICS3D:INVALID_MESH_BUFFER {#physics3d-invalid-mesh-buffer}

Cause. A mesh positions or indices length is not a multiple of 3. Fix. Pass triples.

### PHYSICS3D:NO_RIGID_BODY {#physics3d-no-rigid-body}

Cause. The entity has no rigid body yet. Fix. Call useDynamicBody or useStaticBody first.

### PHYSICS3D:MESH_REBUILD_FAILED {#physics3d-mesh-rebuild-failed}

Cause. Rebuilding the mesh collider failed. Fix. Check the vertices, indices, and body.

### PHYSICS3D:BODY_NOT_FOUND {#physics3d-body-not-found}

Cause. A WASM export found no rigid body for the slot. Fix. Add the body first.

### PHYSICS3D:BODY_ALREADY_EXISTS {#physics3d-body-already-exists}

Cause. The slot already has a rigid body. Fix. Remove it before adding another.

### PHYSICS3D:INVALID_BODY_KIND {#physics3d-invalid-body-kind}

Cause. Body kind is not 0, 1, or 2. Fix. Use fixed, dynamic, or kinematic.

### PHYSICS3D:BUFFER_LENGTH_MISMATCH {#physics3d-buffer-length-mismatch}

Cause. Parallel slices of a bulk call differ in length. Fix. Pass equal-length buffers.

### PHYSICS3D:COLLIDER_NOT_FOUND {#physics3d-collider-not-found}

Cause. No collider is registered for that slot and id. Fix. Add it before the call.

### PHYSICS3D:COLLIDER_ALREADY_EXISTS {#physics3d-collider-already-exists}

Cause. That collider id is already registered on the slot. Fix. Use a new id.

### PHYSICS3D:INVALID_SHAPE {#physics3d-invalid-shape}

Cause. Shape data cannot build a collider. Fix. Check the heightfield, mesh, or points.

### PHYSICS3D:JOINT_NOT_FOUND {#physics3d-joint-not-found}

Cause. No joint is registered for that id. Fix. Create the joint before using it.

### PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND {#physics3d-character-controller-not-found}

Cause. No character controller is registered for the slot. Fix. Add one first.

### PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED {#physics3d-character-controller-limit-reached}

Cause. The character controller pool is full. Fix. Remove one or raise the limit.

### PHYSICS3D:NAVGRID_NOT_INITIALIZED {#physics3d-navgrid-not-initialized}

Cause. A path query ran before the navigation grid was uploaded. Fix. Upload the grid first.

### PHYSICS3D:INVALID_NAVGRID {#physics3d-invalid-navgrid}

Cause. Grid dimensions are zero, overflow, or pass the cell limit. Fix. Use a smaller grid.

### PHYSICS3D:INVALID_PATH_REQUEST {#physics3d-invalid-path-request}

Cause. A path coordinate is not finite or is past the cell bound. Fix. Use an in-range cell.

### PHYSICS3D:INVALID_COLLIDER {#physics3d-invalid-collider}

Cause. A collider size, radius, or skin width was refused. Fix. Pass a finite accepted value.

### PHYSICS3D:INVALID_JOINT {#physics3d-invalid-joint}

Cause. A joint anchor, axis, spring, motor, or limit is not finite. Fix. Pass finite numbers.

### PHYSICS3D:INVALID_QUERY {#physics3d-invalid-query}

Cause. A query coordinate, direction, or distance was refused. Fix. Pass finite values.

### PHYSICS3D:INVALID_STEP_DELTA {#physics3d-invalid-step-delta}

Cause. A step delta is not finite or is outside 0 to 1. Fix. Pass a delta in that range.

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
