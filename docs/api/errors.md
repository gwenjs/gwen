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
| `CONFORMANCE`    | `@gwenjs/plugin-conformance` (gwen)              | `ConformanceErrorCodes`   | `https://gwenjs.github.io/gwen`           |
| `AUDIO`          | gwenjs/audio                                     | —                         | `https://gwenjs.github.io/audio`          |
| `ASSETS`         | gwenjs/assets                                    | —                         | `https://gwenjs.github.io/assets`         |
| `RENDERER_THREE` | `@gwenjs/renderer-three` (gwenjs/renderer-three) | `RendererThreeErrorCodes` | `https://gwenjs.github.io/renderer-three` |
| `INSPECTOR`      | `@gwenjs/inspector` (gwenjs/inspector)           | `InspectorErrorCodes`     | `https://gwenjs.github.io/inspector`      |

`RENDERER_THREE` throws `WEBGL_UNAVAILABLE`, `NOT_MOUNTED`, and `OBJECT_ALREADY_ATTACHED`. `INSPECTOR` has no codes on this page.

## Reserved codes

- `CORE:INTROSPECTION_PAGE_INVALID` {#core-introspection-page-invalid}
- `APP:PLUGIN_REQUIREMENT_MISSING` {#app-plugin-requirement-missing}
- `APP:PLUGIN_REQUIREMENT_ORDER` {#app-plugin-requirement-order}
- `APP:SERVICE_PROVIDER_MISSING` {#app-service-provider-missing}

## @gwenjs/core

### CORE:HOOK_NAME_INVALID {#core-hook-name-invalid}

Cause. The name is not `namespace:action` (`reason` `"format"`), or `emit` / a plugin `engine.hooks.callHook*` used a reserved namespace (`reason` `"reserved"`): `engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, `service`. Fix. Use `"namespace:action"`, for example `"enemy:died"`. Listen to a reserved name with `useHook`. Emit a name from your own namespace, declared with `defineHooks`.

### CORE:OUTSIDE_ENGINE_CONTEXT {#core-outside-engine-context}

Cause. The call is outside `defineSystem()`, `defineActor()`, `defineScene()`, `plugin setup()`, or `engine.run()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_ACTOR_CONTEXT {#core-outside-actor-context}

Cause. The call is outside `defineActor()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

`useEntityId`, `useTransform`, `useChildren`, `useComponent` (one-argument form), `onStart`, `onDestroy`, `onRelease`, `onReset`, `onEnable`, and `onDisable` throw this code. So do the physics composables `useDynamicBody`, `useKinematicBody`, `useStaticBody`, `useShape`, `useBoxCollider`, `useSphereCollider`, `useCapsuleCollider`, `useConvexCollider`, `useMeshCollider`, `useHeightfieldCollider`, and `useCompoundCollider`.

### CORE:OUTSIDE_SYSTEM_CONTEXT {#core-outside-system-context}

Cause. The call is outside `defineSystem()` or `defineActor()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

`onBeforeUpdate`, `onUpdate`, `onAfterUpdate`, and `onRender` throw this code. They throw it inside a `defineScene()` factory and inside a plugin `setup()` too: only a system or an actor owns a frame loop.

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
- `CORE:DEFINITION_INCOMPLETE` {#core-definition-incomplete} `defineSystem(name)`, `defineComponent(name)`, `defineActor(name, prefab)` or `defineActor(prefab)` was called without its setup function or factory. The error is thrown when the system is set up, or at the `defineComponent` and `defineActor` call. It is also thrown when `defineActor` gets its arguments in the wrong order, or a function as third argument.
- `CORE:INVALID_COMPONENT_TYPE` {#core-invalid-component-type}
- `CORE:INVALID_SCENE_ROUTE` {#core-invalid-scene-route} — `defineSceneRouter` throws `GwenSceneRouterError` when `initial` or a transition target is not a route key.
- `CORE:SCENE_PRELOAD_FAILED` {#core-scene-preload-failed} — a `scene:preload` handler rejection throws `GwenScenePreloadError`: `cause` is the first rejection, the transition is cancelled, and progress `1` is not emitted.
- `CORE:FRAME_LOOP_ERROR` {#core-frame-loop-error}
- `CORE:PLUGIN_SETUP_ERROR` {#core-plugin-setup-error}
- `CORE:PLUGIN_RUNTIME_ERROR` {#core-plugin-runtime-error}
- `CORE:WASM_LOAD_ERROR` {#core-wasm-load-error} `initWasm` maps `WebAssembly.LinkError` and `WebAssembly.CompileError` from `glue.initSync` to this code (`packages/core/src/engine/wasm-instance-provider.ts:69`). The `cause` is that error. The message is that error's text, written as a sentence (`packages/core/src/engine/wasm-instance-provider.ts:70`).
- `CORE:WASM_TIMEOUT` {#core-wasm-timeout}
- `CORE:WASM_PANIC` {#core-wasm-panic}
- `CORE:QUERY_CAPACITY_EXCEEDED` {#core-query-capacity-exceeded}
- `CORE:ENTITY_LIMIT_REACHED` {#core-entity-limit-reached}
- `CORE:COMPONENT_TYPE_LIMIT_REACHED` {#core-component-type-limit-reached} — registering one more component type throws `GwenComponentLimitError`.
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
- `CORE:PLUGIN_INVALID_SHAPE` {#core-plugin-invalid-shape} `engine.use` rejected a plugin that declares a lifecycle key the engine never calls, an invalid `extensionApi` (`major` an integer >= 1, `minor` an integer >= 0), or an invalid `requires.plugins` entry (no string name, invalid `extensionApi`, or the same name twice). `keys` names the field.
- `CORE:PLUGIN_IN_USE` {#core-plugin-in-use} `engine.unuse` rejected because an installed plugin still requires this plugin or one of its services.
- `CORE:PLUGIN_EXTENSION_API_MISMATCH` {#core-plugin-extension-api-mismatch} `engine.use` rejected an extension because an installed base has a different extension API major, a lower minor, or none. `mismatches` lists each base. `setup` was not called and nothing reached `engine.errors`.
- `CORE:PLUGIN_OPTIONS_INVALID` {#core-plugin-options-invalid} `engine.use` rejected a plugin whose `validateOptions()` returned issues. `setup` was not called and nothing reached `engine.errors`. The message lists one line per issue.
- `CORE:PLUGIN_PROVIDE_DUPLICATE` {#core-plugin-provide-duplicate} `engine.use` rejected a plugin that declares a key in `provides` that an installed plugin, a plugin still installing, or the engine already holds. `owner` is that plugin's name, or `<engine>`.
- `CORE:PLUGIN_PROVIDE_UNDECLARED` {#core-plugin-provide-undeclared} `provide` on the setup engine received a key the plugin did not declare in `provides`. It throws from the setup engine, so `setup` fails through the normal path.
- `CORE:PLUGIN_PROVIDE_MISSING` {#core-plugin-provide-missing} `setup` resolved without providing every key the plugin declared in `provides`. The plugin is removed and `teardown` runs. No `CORE:PLUGIN_SETUP_ERROR` is emitted.
- `CORE:TWEEN_POOL_EXHAUSTED` {#core-tween-pool-exhausted} Thrown by `TweenPool.claim`, and by `useSequence` when a wait step cannot claim a slot because the `'drop'` pool is exhausted.
- `CORE:WASM_GLUE_MISMATCH` {#core-wasm-glue-mismatch} `checkGwenModule` rejects a compiled module that does not match its glue. `init` calls the check before it acquires an instance (#263).

  | `reason`      | Meaning                                                           | `expected`                   | `actual`                                                                           |
  | ------------- | ----------------------------------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------- |
  | `build`       | Build ids differ, or `gwen.build` is absent or repeated.          | Glue `buildId`.              | Section text, `<no gwen.build section>`, or `<n gwen.build sections>`.             |
  | `fingerprint` | Fingerprints differ, or `gwen.fingerprint` is absent or repeated. | Glue fingerprint.            | Section text, `<no gwen.fingerprint section>`, or `<n gwen.fingerprint sections>`. |
  | `exports`     | A glue `rawExports` name is not a module export.                  | Missing names joined by `,`. | `<absent>`                                                                         |
  | `imports`     | The module imports a name the contract does not list.             | `<not in contract>`          | Those names joined by `,`.                                                         |

- `CORE:ENGINE_DISPOSED` {#core-engine-disposed} Thrown by `createEngineLocal().get()` when it would create a value after `engine.stop()` began disposing, and by `WasmBridgeImpl` after `engine.stop()`.
- `CORE:WASM_CAPACITY_EXHAUSTED` {#core-wasm-capacity-exhausted} Thrown by `initWasm`, from the instance providers (`packages/core/src/engine/wasm-instance-provider.ts:57`), when `glue.initSync` throws a `RangeError` or a value that is not an `Error` (`packages/core/src/engine/wasm-instance-provider.ts:58`). The message is `Cannot create another WASM instance (mode "${mode}", ${live} live).` (`packages/core/src/engine/wasm-instance-provider.ts:61`). `cause` is the thrown value (`packages/core/src/engine/wasm-instance-provider.ts:64`). In development, `hint` is `Use wasmInstance: "shared", fewer engines per process, or worker threads.` (`packages/core/src/engine/wasm-instance-provider.ts:65`). The fallbacks are `wasmInstance: "shared"`, fewer engines per process, or worker threads. `mode` can be `"auto"` only when the pool instance itself cannot be created (`packages/core/src/engine/wasm-instance-provider.ts:185`); otherwise `auto` joins the pool.
- `CORE:INVALID_ENGINE` {#core-invalid-engine} Thrown by `createEngineLocal().get()` when the argument is not an engine.
- `CORE:ENGINE_LOCAL_REENTRANT` {#core-engine-local-reentrant} Thrown by `createEngineLocal().get()` when `init` reads the same local for the engine it is building.

## @gwenjs/kit

- `KIT:MODULE_INVALID` {#kit-module-invalid} Thrown by `defineGwenModule()` when `meta`, `meta.name`, `meta.configKey`, `meta.version`, `defaults`, `setup`, or `validate` is invalid. `fields` lists every failing path. The message names those fields.
- `KIT:PLUGIN_SETUP_FAILED` {#kit-plugin-setup-failed} Cause. Nothing in @gwenjs/kit throws this code any more; `definePlugin` no longer wraps `setup`, and a setup failure is `CORE:PLUGIN_SETUP_ERROR` (anchor #core-plugin-setup-error).

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. Nothing in @gwenjs/schema throws this code. The check left with assertModuleFirstInput. Fix. Declare modules in gwen.config.ts. A bad entry is APP:CONFIG_INVALID from `resolveGwenConfig` in `@gwenjs/app/resolve`.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. Nothing in @gwenjs/schema throws this code. The check left with validateResolvedConfig. Fix. A range error in gwen.config.ts is APP:CONFIG_INVALID from `resolveGwenConfig` in `@gwenjs/app/resolve`. The createEngine path is CORE:INVALID_CONFIG.

## @gwenjs/app

### APP:MODULE_SETUP_FAILED {#app-module-setup-failed}

Cause. A module `setup()` threw. The `cause` is that throw. Fix. Read the cause message and fix the module setup.

### APP:MODULE_LOAD_FAILED {#app-module-load-failed}

Cause. The module package or file could not be imported, the import fails module validation (the `cause` is `KIT:MODULE_INVALID` and names the fields), or a custom `moduleLoader` threw. A package with no `./module` export is `APP:MODULE_ENTRY_MISSING`. Fix. Check the name and that the package is installed. In development a missing package says to run `gwen add <name>`.

### APP:MODULE_ENTRY_MISSING {#app-module-entry-missing}

Cause. A module package declares no `./module` export. The message names the package. Fix. Export `./module` (`defineGwenModule`), or remove the package from `modules`.

### APP:PLUGIN_NOT_DECLARATIVE {#app-plugin-not-declarative}

Cause. `kit.addPlugin()` received something that is not a `PluginDeclaration { src, export?, options? }` (an instance, a function, or an object without a string `src`), or the `options` are not JSON-serializable (message `Plugin declaration "<src>" has options that are not JSON-serializable.`). The failure is wrapped in `APP:MODULE_SETUP_FAILED`, whose `cause` is this error. Fix. Declare the package and its export, `kit.addPlugin({ src: "<pkg>", export: "<Factory>", options })`, and pass JSON data only.

### APP:CONFIG_LOAD_FAILED {#app-config-load-failed}

Cause. No `gwen.config.ts` (or `.js` / `.mjs` / `.cjs`) was found, or the file threw while loading. Fix. Add the config file, or fix the syntax error named in the message. When the file threw, `cause` is that error.

### APP:CONFIG_INVALID {#app-config-invalid}

Cause. A field does not match the expected shape. `resolveGwenConfig` reports an engine field, a non-object `engine` or `logger`, a tuple module entry, and a variant shape. `GwenApp.setupModules` reports an unknown top-level key, a module section that is not an object, a `validate` issue, and a value that is not JSON-serializable, including a cycle or `undefined` in an array. The message names the path, the expected shape, and the received value. An empty config path renders `Invalid gwen.config:` with no parentheses. Fix. Use a value the message names.

### APP:CONFIG_CONFLICT {#app-config-conflict}

Cause. An explicit `engine.variant` contradicts a physics module (`resolveGwenConfig`), two modules share one `configKey`, or a `configKey` is reserved (`GwenApp.setupModules`). The message names both sides. Fix. Keep one owner, or set `engine.variant` to the variant derived from the modules.

## @gwenjs/vite

### VITE:OPTIMIZER_UNKNOWN_COMPONENT {#vite-optimizer-unknown-component}

Cause. The code generator was asked for a component the manifest does not contain. Fix. Register the component before generating bulk code.

### VITE:OPTIMIZER_UNKNOWN_FIELD {#vite-optimizer-unknown-field}

Cause. The field is not on that component in the manifest. Fix. Use a field that the component manifest lists.

### VITE:SCENE_NAME_UNRESOLVED {#vite-scene-name-unresolved}

Cause. `scanScenes` (`packages/vite/src/scanners/index.ts:118`) read a file under `src/scenes/` whose scene name is not a string literal. The message is `Scene file "${rel}" has no literal scene name.` (`packages/vite/src/scanners/index.ts:138`). A file whose name starts with `_` or `.` is skipped (`packages/vite/src/scanners/index.ts:126`). Fix. Call `defineScene` with a string literal, or prefix a helper file with `_`.

### VITE:SCENE_NAME_DUPLICATE {#vite-scene-name-duplicate}

Cause. Two scene files declare the same literal name. The message is `Scene name "${sceneName}" is declared in "${previous}" and "${rel}".` (`packages/vite/src/scanners/index.ts:153`). Fix. Give each file its own string literal.

### VITE:MAIN_SCENE_UNKNOWN {#vite-main-scene-unknown}

Cause. `resolveMainScene` (`packages/vite/src/scanners/index.ts:183`) received a `mainScene` that is not a discovered name. The message lists those names (`packages/vite/src/scanners/index.ts:192`). With no `mainScene`, the first discovered scene is used (`packages/vite/src/scanners/index.ts:204`). Fix. Set `mainScene` to a name discovered under `src/scenes/`.

### VITE:TRANSFORM_PARSE_FAILED {#vite-transform-parse-failed}

Cause. `parseModule` could not parse the module. The message starts with the id, the 1-based line, and the 1-based column. `loc.column` is 0-based, which is what Vite reads. Fix. Fix the syntax error; the GWEN build never skips a module it cannot parse.

### VITE:TRANSFORM_EDIT_CONFLICT {#vite-transform-edit-conflict}

Cause. Two units edit overlapping ranges in one module. The message names both units and the ranges. An insert exactly at the start or end of another edit is not an overlap. Two inserts at one offset stay in registry order. Fix. Move one edit so the ranges no longer overlap.

### VITE:TRANSFORM_UNSUPPORTED {#vite-transform-unsupported}

Cause. Thrown from four sites. `register()` was called after `gwen:transform-pipeline`'s `buildStart`. `register()` was called with a different unit under a taken name. The message is `register() was called with a different unit named …`. `useActor(Y)` inside an actor factory, when `Y` is not a module-scope binding or when `Y` is a `const`, `let`, `var`, or `class` declared after that actor. A nested `await` inside an await argument of `onEnter`, `onExit`, or `withAsyncContext`. Fix. `register()` is accepted until `buildStart`, for example from any plugin's `configResolved`. Register one unit object per name. Declare `Y` at module scope, before the actor, or pass it through the factory arguments. Assign the inner await to a const first.

### VITE:BVH_PREBAKE_FAILED {#vite-bvh-prebake-failed}

Cause. `gwen:bvh-prebake` throws this when a relative `useMeshCollider` `.glb` is not on disk (`packages/vite/src/transforms/bvh-prebake.ts:134`), or when reading that file or baking it throws (`packages/vite/src/transforms/bvh-prebake.ts:102`). An absent file names the absolute path. A thrown bake names the relative path and keeps the original error as `cause`. The `Fix:` line is present only when `NODE_ENV` is not `production` (`packages/vite/src/pipeline/dev-hint.ts:7`). Fix. Check the path relative to the importing file. Export the mesh as triangles.

## @gwenjs/math

### MATH:INVALID_HEX_COLOR {#math-invalid-hex-color}

Cause. `colorFromHex` received a string that is not `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Fix. Use one of those forms.

## @gwenjs/physics2d

### PHYSICS2D:STALE_ENTITY {#physics2d-stale-entity}

Cause. The entity is not alive. Fix. Create it again before the call.

### PHYSICS2D:STALE_BODY_HANDLE {#physics2d-stale-body-handle}

Cause. The code stays in `Physics2DErrorCodes` (`packages/physics2d/src/errors.ts:11`) and `Physics2DStaleBodyHandleError` stays exported (`packages/physics2d/src/errors.ts:64`). The plugin does not throw that class. A collider call on an entity with no rigid body throws `PHYSICS2D:BODY_NOT_FOUND` (`packages/physics2d/src/plugin/index.ts:297`). A call on an entity that is not alive throws `PHYSICS2D:STALE_ENTITY` (`packages/physics2d/src/plugin/index.ts:283`). WASM `physics_add_box_collider` and `physics_add_ball_collider` still return `PHYSICS2D:STALE_BODY_HANDLE` when the numeric body handle is not registered (`crates/gwen-core/src/physics2d/world.rs:281`, `crates/gwen-core/src/physics2d/world.rs:370`). `callPhysicsExport` forwards every `PHYSICS2D:` code (`packages/physics2d/src/plugin/index.ts:321`, `packages/physics2d/src/plugin/index.ts:325`), so that code can still reach the caller.

### PHYSICS2D:INVALID_LAYERS {#physics2d-invalid-layers}

Cause. The code remains in `Physics2DErrorCodes` (`packages/physics2d/src/errors.ts:9`). A bad layer bit or more than 32 layers is no longer thrown as this code. `checkPhysics2DConfig` (`packages/physics2d/src/config.ts:57`) reports those as issues of `CORE:PLUGIN_OPTIONS_INVALID`: path `layers.<name>` for a bit (`packages/physics2d/src/config.ts:46`), path `layers` when the count exceeds 32 (`packages/physics2d/src/config.ts:62`). `engine.use` rejects before `setup`. Fix. Use an integer bit from 0 to 31, and at most 32 layers.

### PHYSICS2D:UNKNOWN_LAYER {#physics2d-unknown-layer}

Cause. The layer name is not declared. Fix. Add it to Physics2DConfig.layers.

### PHYSICS2D:INVALID_COLLIDER {#physics2d-invalid-collider}

Cause. A prefab collider lacks radius, size, or a known shape. Fix. Pass those fields.

### PHYSICS2D:WASM_VARIANT_MISMATCH {#physics2d-wasm-variant-mismatch}

Cause. The core WASM build has no physics. Fix. Load a variant that includes it.

### PHYSICS2D:INVALID_PREFAB_EXTENSION {#physics2d-invalid-prefab-extension}

Cause. The prefab extension has no colliders array. Fix. Set extensions.physics2d.colliders.

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

### PHYSICS2D:VITE_PIPELINE_MISSING {#physics2d-vite-pipeline-missing}

Cause. The Vite config has no gwen:transform-pipeline. Fix. Add gwen() from @gwenjs/vite to the Vite config.

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

### PHYSICS3D:INVALID_LAYERS {#physics3d-invalid-layers}

Cause. `buildLayerRegistry` (`packages/physics3d/src/config.ts`) received more than 32 layers, or a bit that is not an integer in `0..31`. The shared registry reports `LAYER_LIMIT` or `LAYER_BIT_RANGE` (`packages/physics-core/src/layer-registry.ts:34-46`). The plugin maps both to this code (`packages/physics3d/src/config.ts:78-80`, `packages/physics3d/src/errors/codes.ts:13`). Fix. Use an integer bit from 0 to 31, and at most 32 layers.

### PHYSICS3D:UNKNOWN_LAYER {#physics3d-unknown-layer}

Cause. The layer name is not in the registry. Fix. Declare it before resolving bits.

### PHYSICS3D:UNKNOWN_MATERIAL {#physics3d-unknown-material}

Cause. The material name is not `default`, `ice`, `rubber`, or `metal`. Fix. Use one of those names. Resolved on the WASM backend only.

### PHYSICS3D:INVALID_COMPOUND {#physics3d-invalid-compound}

Cause. Shape ids differ in length, a shape was not inserted, the Rust buffer length is not a multiple of 12, or a part has an unknown shape type. Fix. Match the lengths.

### PHYSICS3D:BVH_LOAD_FAILED {#physics3d-bvh-load-failed}

Cause. The BVH fetch, worker, or export failed, or a mesh buffer is shared memory, which cannot be transferred to the worker. Rust also rejects a short buffer, a magic other than GBVH, another Rapier version, or a payload that is not a valid mesh. Fix. Check the URL, worker, and WASM build.

### PHYSICS3D:NOT_INITIALIZED {#physics3d-not-initialized}

Cause. step() ran before the plugin initialized, or bulkSpawnStaticBoxes() ran while the plugin has no engine (after teardown). Fix. Call setup before step, and do not use a held service after teardown.

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

### PHYSICS3D:VITE_PIPELINE_MISSING {#physics3d-vite-pipeline-missing}

Cause. The Vite config has no gwen:transform-pipeline. Fix. Add gwen() from @gwenjs/vite to the Vite config.

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

Cause. `getOrCreateLayerManager` found a `layerManager` value that is not this package's `LayerManager`. Fix. Remove that value. `gwen:viewports` provides the `LayerManager` this package created.

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

## @gwenjs/plugin-conformance

### CONFORMANCE:ATTW {#conformance-attw}

Cause. `attw --pack --profile esm-only` reports a problem on the tarball that `npm pack` makes of the package. One finding per problem kind and entry point, with the resolutions that fail, for example `UntypedResolution at "./module" (node16-esm, bundler)`. A problem that names a file and no entry point is one finding per problem kind and file, for example `FalseCJS in "dist/index.d.cts"`. The profile ignores `node10` and `node16-cjs`. The tarball is made with `npm pack --ignore-scripts`: lifecycle scripts do not run, unlike `attw --pack`. The `.attw.json` of the package is ignored: attw runs outside the package, so a package cannot exclude its own entry points. It is also reported when `npm pack` fails (`npm` must be on the `PATH`), when attw output cannot be read, or when the package ships no types. The check runs only when `exports` has no finding. Fix. Follow the link in the hint, and make `exports` and the `.d.ts` files resolve their types for every entry point.

### CONFORMANCE:AUGMENT_TARGET {#conformance-augment-target}

Cause. A `declare module` block names a framework package other than `@gwenjs/schema` (for example `@gwenjs/core` or `@gwenjs/kit`), or a `declare module "@gwenjs/schema"` block adds a `GwenProvides` key that the framework already declares (the message names the key and the package that declares it). The package's own name and its subpaths are not reported. Every script file of `src`, every declaration file (`.d.ts`, `.d.mts`, `.d.cts`) under `src` or under a `tests`, `test` or `__tests__` directory, and every test file is read, through the TypeScript API: a `declare module` in a comment is not read. `dist` is not read. The key list is generated from the framework sources, like `FRAMEWORK_ENTRIES`. For a community package, the same code is also reported when a `declare module "@gwenjs/schema"` block adds a `GwenProvides`, `GwenRuntimeHooks` or `GwenPluginRegistry` key that the `./extension` declaration of an installed base already declares. The base's `./extension` declaration is read as syntax, and the declaration files it references inside the base directory are followed. The message names the interface, the key and the base. One finding per key. When a `GwenProvides` key is also a framework key, the framework message is the one reported. An official package is not compared with its bases. A key the base does not declare is not reported. A base that cannot be resolved, or whose `package.json` cannot be parsed, adds no key. Fix. Augment `@gwenjs/schema` (`GwenProvides`, `GwenRuntimeHooks`) instead, and pick a service key of your own, for example `"<plugin>:<service>"`. A key an installed base already declares needs a key of your own: a service `"<plugin>:<service>"`, a hook `"<plugin>:<event>"`, or a registry key.

### CONFORMANCE:BASE_NOT_EXTENSIBLE {#conformance-base-not-extensible}

Cause. A package name kept from `gwen.extends` (a valid, unique package name other than this package, a framework package name included) cannot be resolved from `node_modules` (the package root and its ancestors), its installed `package.json` cannot be parsed, `exports` has no `"./extension"` entry, or it has no `gwen.hookNamespace`. A string and a condition object both count as an `"./extension"` entry. One finding per base per problem, on the `package.json` line of that element. A base that cannot be resolved or parsed produces that one finding and is not checked further. The check runs for both profiles. Fix. Install the base, give it a `package.json` that parses, export `"./extension"` as a string or a condition object, and set `gwen.hookNamespace`.

### CONFORMANCE:DEV_PIN {#conformance-dev-pin}

Cause. A framework package (a key of `FRAMEWORK_RANGES`) is listed in `devDependencies` with a spec that is not an exact version. An exact version is `major.minor.patch`, with an optional prerelease and build, such as `1.0.0-integration.20261123120000.gabc1234`. A range (`^`, `~`, `*`, `latest`, `>=`, `1.x`), a `workspace:` spec, a `file:` spec, or an `npm:` alias is not exact. A missing devDependency is not a finding. One finding per package, on the `package.json` line of the key. The check runs for both profiles. Fix. Pin the package in `devDependencies` to the exact version the tests run against.

### CONFORMANCE:EXPORTS_INVALID {#conformance-exports-invalid}

Cause. A string `exports` target must start with `./` and be a file inside the package. A target that is not a string, an array, an object, or `null` is rejected. `null` is skipped. `exports` missing, not an object, or empty is rejected, and so is a mix of subpath keys and condition keys. In a condition object, `types` must be first. `./internal`, `./internal/…`, and a key that starts with `./internal*` are rejected. Profile `plugin` also requires `.` and `./module`. A subpath pattern (`*`) is not existence-checked. Fix. Point each string target at a `./` file inside the package, keep `exports` a non-empty object of one shape, put `types` first, remove internal subpaths, and add `.` and `./module` for a plugin.

### CONFORMANCE:EXTENSION_ENTRY {#conformance-extension-entry}

Cause. A community package imports a package listed verbatim in `gwen.extends`, and the specifier is not `<base>/extension`. A segment `internal` or `wasm` stays `IMPORT_INTERNAL`, including in a `dist` file. A segment `dist` or `src` stays `IMPORT_DEEP`. The package root and any other subpath, including `<base>/testing`, `<base>/module`, `<base>/extension/sub` and `<base>/extension.js`, are `EXTENSION_ENTRY`. A test file may import the root and `<base>/testing`. In `dist`, only an internal specifier is reported. The base is a package name, not a framework package and not a forbidden package. An official package keeps `IMPORT_FOREIGN_PLUGIN`. One finding per import line. Fix. Import only `<base>/extension` from a base.

### CONFORMANCE:EXTENSION_OFFICIAL {#conformance-extension-official}

Cause. An official package (its name starts with `@gwenjs/` and it is not a framework package) lists at least one valid, unique package name other than its own in `gwen.extends`. One finding, on the `package.json` line of the `gwen.extends` key. The message names the package and each listed base. A community package, a framework package, an absent `gwen.extends`, an empty array, and a value that is not an array are accepted. An entry that is not a string, a repeated name, the package's own name, and a value that is not a package name are left out of that message. The check runs for both profiles. Fix. Remove `gwen.extends`. An official package names only plugins of its own package and framework plugins: use `requires.services` or `requires.optional` on schema contracts.

### CONFORMANCE:EXTENSION_PEER {#conformance-extension-peer}

Cause. A package name kept from `gwen.extends` (a valid, unique package name other than this package) is absent from `peerDependencies`, is also listed in `dependencies` or `optionalDependencies`, has a peer range that is not a usable semver range, or has no exact `devDependencies` pin inside that range. An absent peer is reported on the line of the `gwen.extends` element. A `dependencies` or `optionalDependencies` entry is reported on the line of that key. An unusable range (`*`, `x`, `X`, `x.x.x`, `>=0.0.0` or `>=0.0.0-0` after normalisation, an empty spec, `latest`, or a `workspace:`, `file:`, `link:` or `npm:` spec) is reported on the line of the peer key, and the pin is not checked. A usable range with no exact pin is reported on the line of the `gwen.extends` element. A pin that is not an exact version, or that does not satisfy the range (prerelease included), is reported on the line of the `devDependencies` key. One finding per base per problem. A section that is not an object is skipped. The check runs for both profiles. Fix. Declare the base in `peerDependencies` on a usable semver range, keep it out of `dependencies` and `optionalDependencies`, and pin an exact version inside that range in `devDependencies`.

### CONFORMANCE:HOOK_DYNAMIC_NAME {#conformance-hook-dynamic-name}

Cause. The name passed to `emit`, `callHook`, `callHookParallel`, or `callHookWith` is not a string literal, a template literal without substitution, or an identifier that names a `const` string literal of the same file, so the check cannot read it. One finding per call. A call through an alias (`const fire = engine.hooks.callHook`) is not an emit site and is not checked. Fix. Pass a string literal, or a `const` initialised with one, as the hook name.

### CONFORMANCE:HOOK_FOREIGN_NAMESPACE {#conformance-hook-foreign-namespace}

Cause. A name declared with `defineHooks` or in a `GwenRuntimeHooks` augmentation of `@gwenjs/schema`, or a name passed to an emit call, does not start with `<hookNamespace>:`. `hookNamespace` is `gwen.hookNamespace` in `package.json`. The check is skipped when that value is missing or invalid. Fix. Rename the hook to `<hookNamespace>:<action>`.

### CONFORMANCE:HOOK_NAMESPACE_INVALID {#conformance-hook-namespace-invalid}

Cause. `gwen.hookNamespace` is not a string, does not match `^[a-z][a-z0-9-]*$`, is one of the reserved core namespaces (`engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, `service`), or is a framework namespace (`viewport`, `camera`, `physics`, `physics3d`). It is also reported when it is missing and the package declares or emits a hook. The format and reserved checks are one finding on `package.json` line 1. It is also reported when the value equals the `gwen.hookNamespace` of a base listed in `gwen.extends` that is installed and whose `package.json` parses: one finding per such base, on the same line, and the message names both. A base that cannot be resolved or parsed is left out of this comparison. Fix. Set `gwen.hookNamespace` to a lowercase name of your own, for example `"myplug"`, and do not reuse the hookNamespace of a base.

### CONFORMANCE:HOOK_RESERVED {#conformance-hook-reserved}

Cause. An emit call (`emit`, `callHook`, `callHookParallel`, `callHookWith`) uses a name whose namespace is reserved by the core (`engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, `service`) or owned by a framework package (`viewport`, `camera`, `physics`, `physics3d`). Fix. Listen to that hook with `useHook`, and emit a hook from your own namespace.

### CONFORMANCE:HOOK_UNDECLARED {#conformance-hook-undeclared}

Cause. An emit call uses a name in the package namespace that no file of the package declares, neither with `defineHooks` nor in a `GwenRuntimeHooks` augmentation of `@gwenjs/schema`. The check is skipped when `gwen.hookNamespace` is missing or invalid. `runPluginConformance` also returns this code when a plugin emits at runtime a name it did not declare with `defineHooks` or a `GwenRuntimeHooks` augmentation. The same name from one factory is one finding. Names in the `engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, and `service` namespaces (`packages/schema/src/runtime-hooks.ts:234`) and the framework namespaces (`packages/schema/src/runtime-hooks.ts:251`) are ignored here, because the static check owns them. A runtime undeclared emit into a framework namespace is a static finding only. An unexpected throw of the hooks check is also reported under this code, because the dispatch wrapper uses each check's own code (`packages/plugin-conformance/src/runtime/run-checks.ts:121`). Fix. Declare the hook with `defineHooks`, or add it to a `GwenRuntimeHooks` augmentation.

### CONFORMANCE:IMPORT_DEEP {#conformance-import-deep}

Cause. An import reaches past the public entries: a specifier `@gwenjs/<package>/dist/…`, a `dist` or `src` segment of a community base listed verbatim in `gwen.extends` (`<base>/dist/…`, `<base>/src/…`), a subpath that is not an entry of a framework package (for example `@gwenjs/core/nope`), a relative specifier that resolves outside the package root, or an absolute path or a `file:` URL. One finding per import line. In a test file, a subpath of `@gwenjs/plugin-conformance` other than `/runtime` and `/vitest` is also reported. A `src` segment of an `@gwenjs/*` package is not this code. Fix. Import a public entry of the framework package, keep relative imports inside the package, and import `<base>/extension` from a listed base.

### CONFORMANCE:IMPORT_FORBIDDEN_ENTRY {#conformance-import-forbidden-entry}

Cause. An import of a framework entry that a plugin may not use here: `@gwenjs/app`, `@gwenjs/vite`, `@gwenjs/physics2d`, `@gwenjs/physics3d` or `@gwenjs/physics3d-fracture` (any subpath), or a test-only entry (`@gwenjs/core/testing`, `@gwenjs/core/node`, `@gwenjs/renderer-core/testing`) imported from `src`. A test file may import the test-only entries: a `*.test.*` or `*.spec.*` file, or a file under `tests/`, `test/` or `__tests__/`, or a `*.setup.*` file at the package root. Fix. Move the import to a test file, or use a runtime entry of the framework.

### CONFORMANCE:IMPORT_FOREIGN_PLUGIN {#conformance-import-foreign-plugin}

Cause. An import names another plugin: an `@gwenjs/*` package that is not a framework package, or a package of `node_modules` (looked up from the package root and its ancestors) whose `package.json` has `gwen.type` `"plugin"` or lists `@gwenjs/core` in `peerDependencies` or `dependencies`. A package that is not installed, or whose `package.json` cannot be parsed, is not a plugin. In a test file, `@gwenjs/plugin-conformance`, `@gwenjs/plugin-conformance/runtime` and `@gwenjs/plugin-conformance/vitest` are not reported. A community package (a name outside `@gwenjs/`) that lists `<base>` verbatim in `gwen.extends` does not report `<base>/extension` under this code: other specifiers of that base are `EXTENSION_ENTRY`, `IMPORT_INTERNAL` or `IMPORT_DEEP`. `<base>` is a package name, not a framework package and not a forbidden package. An entry that is not a package name, such as `@gwenjs/camera2d/sub`, is not a base, so this code still applies when the installed package is a plugin. An official package keeps this code for a listed base. Fix. Share state through a service or a framework package. A community extension imports only `<base>/extension`.

### CONFORMANCE:IMPORT_INTERNAL {#conformance-import-internal}

Cause. A specifier `@gwenjs/<package>/internal`, or one with a `wasm` segment (`@gwenjs/core/wasm/light`), in `src`, in a test file, or bundled into `dist` (`.js`, `.mjs`, `.cjs`, `.d.ts`, `.d.mts` and `.d.cts` files). The same segments of a community base listed verbatim in `gwen.extends` (`<base>/internal`, `<base>/wasm`) are reported the same way, including when the file sits in `dist`. Imports, `export … from`, `import("…")`, `require("…")`, `import x = require("…")` and `import("…")` types are read (a dynamic import whatever follows its first argument). One finding per import line. Fix. Use a public entry of the framework package, or `<base>/extension` from a listed base.

### CONFORMANCE:IMPORT_NOT_PUBLIC {#conformance-import-not-public}

Cause. A name imported from a framework entry is not in the public API of that entry: a named import, a re-export (`export { x } from`), a default import of an entry with no default export, or a property read on a namespace import (`ns.name`, `ns["name"]`, `ns.Type`). A property read is skipped where an enclosing function, block, `for` or `catch` rebinds the name of the namespace. The names come from `FRAMEWORK_ENTRIES`, which is generated from the `public-api.snap.json` files of the framework (values and types). One finding per name, on the line of the name. The same code is reported for a name imported from `<base>/extension`, where `<base>` is a community package listed verbatim in `gwen.extends` and the base is installed with a `package.json` that parses. The public names are the values and the types exported by the types file of `exports["./extension"]` (`types`, then `types.import`, then `import`). A type-only named import is checked like a value import. A base that cannot be resolved, or whose `package.json` cannot be parsed, is not reported under this code. A file under `dist` is not checked for these names. When that types file is not on disk, one finding on the specifier line says the specifier declares the path, which is not built. When the `./extension` target names no types file and no import file, one finding on the specifier line says so. Fix. Use a name that the public entry exports.

### CONFORMANCE:IMPORT_UNDECLARED {#conformance-import-undeclared}

Cause. A file imports a framework package that `package.json` does not declare: in `src`, in `peerDependencies`; in a test file, in `peerDependencies` or `devDependencies`. A package listed only in `dependencies` is not declared. One finding per import line. Fix. Add the package to `peerDependencies`.

### CONFORMANCE:INVALID_SPEC {#conformance-invalid-spec}

Cause. `checkPluginPackage` received a `profile` that is not `"plugin"` or `"package"`, a bad or empty `lockfileBase`, no `pnpm-lock.yaml` at the ref or in the package root, a `lockfileVersion` other than 9.0, or a git that cannot start. A bad `profile` returns this one finding and runs no check. Each lockfile case is one finding from the `lockfile` check, and the other checks still run. `runPluginConformance` also returns this code and an empty `checks` list when the runtime spec is invalid or the built package cannot be loaded, and it does not throw. `factories` must list at least one factory, and each `export` must be a non-empty string. `packageName` must be a non-empty string equal to the `name` of `<root>/package.json`, where `root` defaults to the process working directory. `frames`, when set, must be an integer greater than or equal to 1. `variant`, when set, must be `"light"`, `"physics2d"`, or `"physics3d"`. The same code is returned when `<root>/package.json` is absent, cannot be read, or is not valid JSON; when `exports` is not an object; when `exports["."].import` (and `exports["./module"].import` when that subpath is present) is not a non-empty `./` string that resolves to a file under the package root; when that target is outside the root or under `src`; or when a factory `export` is not exported by the built entry. The message names `factories`, the export, both package names, `frames` and the minimum 1, or the three variants, as the case is. The loader reads the built root entry only and does not read `<root>/src`. A `frameworkProviders` factory that throws, or whose plugin name is not in `FRAMEWORK_PLUGIN_NAMES`, is this code and `checks` stays empty. A `fixture` that throws is this code too. The `frames` check reports it, so `checks` lists the checks that ran. Fix. Pass `"plugin"` or `"package"` as `profile`. For the lockfile, pass a ref that holds `pnpm-lock.yaml` at the package root, commit the lockfile, and use lockfile v9. For a runtime spec, list at least one factory, set `packageName` to the package name, and point `exports["."].import` at the built entry.

### CONFORMANCE:LOCKFILE_DRIFT {#conformance-lockfile-drift}

Cause. With `lockfileBase` set, a third-party package in `pnpm-lock.yaml` (a name that does not start with `@gwenjs/`) was added, removed, or resolved to a different set of versions than in that git ref. The version is the text of a `packages:` or `snapshots:` key after the name and before the first `(`. One finding per name, on the first key in the new file; a removed package is reported on `<ref>:pnpm-lock.yaml`. Fix. Commit the updated `pnpm-lock.yaml` and review the third-party change, or pin the package. A stack install must move only `@gwenjs` packages.

### CONFORMANCE:MANIFEST {#conformance-manifest}

Cause. Profile `plugin` does not set `gwen.type` to `"plugin"`, `license` is empty or missing, no LICENSE file is at the root, or `package.json` is missing, unreadable, or not valid JSON. A malformed `gwen.extends` is the same code, for both profiles: the value is not an array (line of the key), an entry is not a string (line of that entry), a package name is listed twice (line of the later entry), the package lists its own name (line of that entry), or an entry is not a package name (line of that entry). A package name is an optional `@scope/` plus one segment, with no further `/`, no space and no uppercase. An absent field and an empty array are not findings. One finding per problem. Fix. Set `gwen.type` and a non-empty `license`, add `LICENSE`, `LICENSE.md`, or `LICENSE.txt`, and write valid JSON. Write `gwen.extends` as an array of package names, for example `["fixture-base"]`.

### CONFORMANCE:PEER_RANGE {#conformance-peer-range}

Cause. A framework package (a key of `FRAMEWORK_RANGES`) is listed in `dependencies` or `optionalDependencies` (any spec), or its `peerDependencies` spec is not exactly the range in `FRAMEWORK_RANGES` (strict string equality, no semver parsing). The linked group uses `CORE_RANGE`. `@gwenjs/math` may sit in `dependencies` or `optionalDependencies` at any spec; its peer must still be its own range, not `CORE_RANGE`. A section that is not an object is skipped. A spec that is not a string is shown with `JSON.stringify`. A package outside `FRAMEWORK_RANGES` is ignored. One finding per key, on the `package.json` line of the key. The check runs for both profiles, including when `exports` has a finding. Fix. Declare the package in `peerDependencies` on its `FRAMEWORK_RANGES` range, and pin it exactly in `devDependencies`. Move it out of `dependencies`, except `@gwenjs/math`.

### CONFORMANCE:PEER_UNUSED {#conformance-peer-unused}

Cause. A framework package (an own key of `FRAMEWORK_RANGES`) or a base listed in `gwen.extends` is listed in `peerDependencies` and no non-test script file of `src` uses it. A use is a module specifier read by the import scan (`import`, `export … from`, `import type`, `export type … from`, `import("…")`, `require("…")`) or a `declare module "<package>"` whose name is a string. A subpath such as `@gwenjs/kit/plugin` counts as `@gwenjs/kit`, and `<base>/extension` counts as a use of the base. A `declare module` in a non-test script of `src`, or in a `.d.ts`, `.d.mts` or `.d.cts` file under `src`, counts. A test-only import does not. A package that is neither a framework package nor a listed base is not reported. `src` is read only when the package declares such a peer. One finding per peer, on the `package.json` line of the key. The check runs for both profiles. Fix. Remove the package from `peerDependencies`, or import it from `src`.

### CONFORMANCE:PRIVATE_EXPORT {#conformance-private-export}

Cause. A value exported by a subpath of `exports` (any subpath listed there, public or not) starts with `_`. Names that start with `__` are not read. One finding per value, on the built types file. Fix. Rename the value without the underscore, or stop exporting it.

### CONFORMANCE:PUBLINT {#conformance-publint}

Cause. `publint --strict` reports a message, and warnings count as errors. The finding repeats the publint text and points at the line of the field in `package.json`. It is also reported when publint cannot pack or parse the package. The check runs only when `exports` has no finding. Fix. Change the field as the message says.

### CONFORMANCE:README_EXPORT_MISSING {#conformance-readme-export-missing}

Cause. A name listed in `public-api.snap.json` (a value or a type, of any subpath) is not written in the package `README.md` as a whole identifier: `readyState` does not mention `ready`. One finding per distinct name, for the first subpath that lists it. The name `default` is never required. A missing `README.md` is one finding, `README.md is missing`; a `README.md` that exists and cannot be read (for example, a directory) is one finding, `README.md cannot be read (<code>)`. The check reads the snapshot after a write and runs only when `exports` has no finding. Fix. Document the name in `README.md`, or stop exporting it.

### CONFORMANCE:RUNTIME_COMPOSABLE_CONTEXT {#conformance-runtime-composable-context}

Cause. A function export of the built root entry whose name matches `use` or `on` followed by a capital letter does not throw, when called with no arguments, an error whose `code` is a value of `GwenContextErrorCodes` (`packages/kit/src/context-errors.ts:14`) and whose `composable` equals that export name (`packages/kit/src/context-errors.ts:103`). The comparison reads `code` and `composable`. It does not use `instanceof`. An entry with no such export passes. The message names the export, and names both names when `composable` is another name. Fix. Throw that error from the export, with `composable` set to its name.

### CONFORMANCE:RUNTIME_DEV_WARNING {#conformance-runtime-dev-warning}

Cause. The engine logger recorded an entry at level `warn` or `error` during the run (`packages/schema/src/logger-structured.ts:2`). The message names that entry. `debug` and `info` are not reported. The engine copies a bus event onto the logger (`packages/core/src/engine/engine-error-policy.ts:408`) with the same message and `payload.code` set to the event code. That copy is not a second finding. Fix. Remove the `warn` or `error` call.

### CONFORMANCE:RUNTIME_FRAME_EVENT {#conformance-runtime-frame-event}

Cause. `engine.errors` emitted an event at level `warning`, `error`, or `fatal` during the frames, and the code was not `CORE:QUERY_PER_ENTITY_PATH`. The message names the event code, the event message, and the frame. A fatal event faults the engine, so the next `advance` throws (`packages/core/src/engine/engine-loop.ts:178`). That throw stays inside the check, and the event is the finding. The frame is the 1-based index of that `engine:update`: the third frame is 3. `engine.frameCount` during the hook is still the previous count, because `frameCompleted` runs after the hook (`packages/core/src/engine/engine-loop.ts:385`, `packages/core/src/engine/engine-loop.ts:427`, `packages/core/src/engine/engine-stats.ts:73`). Fix. Stop emitting that event, or lower its level below `warning`.

### CONFORMANCE:RUNTIME_MODULE {#conformance-runtime-module}

Cause. The check runs only when `package.json` `exports` has `"./module"`. A `./module` that fails to import, or whose default export is not an object, is one finding. The default export's `meta.name` is read the way `validateGwenModule` reads it (`packages/kit/src/define-module.ts:69`) and must equal the package name. `setup` is called with the module `defaults`, or `{}`, and a recording kit (`packages/schema/src/module.ts:193`): `addPlugin` records, `addAutoImports`, `addVitePlugin`, `extendViteConfig`, and `hook` are inert, and `options` is `{}`. A `setup` that throws is one finding, and the message names the check and the thrown text. Each recorded value must be a plain object (`packages/app/src/app.ts:433`) with string `src` equal to the package name (`packages/app/src/app.ts:434`), no function value (`packages/app/src/app.ts:357`), and string `export` naming one entry of `spec.factories`. A plugin instance (`name` and `setup`) is one finding. The message names the package and the observed value. `name`, `requires`, and `provides` of a declaration are not checked yet (`packages/schema/src/module.ts:162`). Fix. Set `meta.name` to the package name, and pass `addPlugin` a declaration `{ src, export }` for a factory of this package.

### CONFORMANCE:RUNTIME_OPTIONS {#conformance-runtime-options}

Cause. A factory sets `invalidOptions`. `frameworkProviders` are installed first. `engine.use` must reject with `CORE:PLUGIN_OPTIONS_INVALID`. An install that resolves is one finding. A rejection with another code is one finding, and the message names that code and the thrown text. A throw while the factory is built with those options is one finding. The message names the export and the thrown text. The check does not run when `invalidOptions` is absent. Fix. Reject those options from `definePlugin`'s `options.validate` before `setup`.

### CONFORMANCE:RUNTIME_PER_ENTITY_PATH {#conformance-runtime-per-entity-path}

Cause. A frame emitted `CORE:QUERY_PER_ENTITY_PATH` (`packages/core/src/engine/engine-errors.ts:341`). The message names `context.api` and `context.phase`, for example `Query.each` and `engine:update` (`packages/core/src/engine/engine-internals.ts:142`). This code is dev-only: `warnPerEntityPath` does nothing when `__GWEN_DEV__` is false (`packages/core/src/engine/engine-internals.ts:131`). Only a system hook triggers the warning (`packages/core/src/context/scope.ts:191`, `packages/core/src/engine/engine-internals.ts:134`), so `query.each()` from a plugin's own `engine:update` hook is not reported. A system the package exports as a normal factory is covered. The same event is not also reported as `RUNTIME_FRAME_EVENT`. Fix. Iterate the query by chunk (`for (const chunk of query)`).

### CONFORMANCE:RUNTIME_PROVIDES {#conformance-runtime-provides}

Cause. `frameworkProviders` are installed, then `engine.use`, on one engine per factory. A provide rejection, including a duplicate service, is one finding. The message includes the engine's provide error code. A dependency rejection is not this code. A plugin that provides every declared key passes, and so does a plugin with no `provides`. Fix. Provide every declared key in `setup`, and declare every key you provide.

### CONFORMANCE:RUNTIME_REENTRY {#conformance-runtime-reentry}

Cause. `use`, then `unuse`, then `use` again does not resolve. The message includes the text thrown by that second `use`. When the first `use` rejects, this check stays silent. Fix. Make `setup` succeed on a second install after `unuse`.

### CONFORMANCE:RUNTIME_REMOVE_LEAK {#conformance-runtime-remove-leak}

Cause. After `unuse(name)`, a `provides` key is still injectable, or `hookListeners` or `plugins` is not the baseline read after `frameworkProviders` and before `use` (`packages/core/src/engine/gwen-engine.ts:566`). The message for extra listeners is `plugin "<name>" left 2 hook listeners after unuse (baseline 14, after 16)`. A listener registered on the real engine (`useEngine()` during `setup`, `packages/core/src/engine/plugin-registry.ts:310`) is not removed: only a hook registered through the setup proxy is tracked (`packages/core/src/engine/plugin-registry.ts:727`, `packages/core/src/engine/hook-tracker.ts:27`). A `provide` on that same real engine is not removed (`packages/core/src/engine/gwen-engine.ts:237`). A plugin that installs a system from `setup` is reported here and by `RUNTIME_REQUIRES`: the system is itself a plugin (`packages/core/src/system/runtime/define-system.ts:266`) and `unuse` of the parent leaves it (`packages/camera-core/src/camera-core-plugin.ts:70`, `packages/core/src/engine/plugin-registry.ts:445`). One more frame is advanced at `1/60`. A bus event at `warning`, `error`, or `fatal`, or a logger entry at `warn` or `error`, from `unuse` through that frame is a finding. A logger copy of a bus event is not a second finding (`packages/core/src/engine/engine-error-policy.ts:407`). Fix. Register hooks and `provide` on the `engine` argument of `setup`, and export a system as its own factory.

### CONFORMANCE:RUNTIME_REQUIRES {#conformance-runtime-requires}

Cause. `frameworkProviders` are installed, then a sibling factory of this package when `requires.plugins` names it, then `engine.use`. The installed plugins must be that baseline plus the plugin name. Any other installed name is a hidden install, and the message lists the installed plugins. A `use` rejection that is not the engine dependency code and not a provide code is one finding, and the message carries the engine code, when there is one, and the thrown text. When that dependency error names no entry this check still allows, the check stays silent. A community plugin (`official` false, or a `packageName` outside `@gwenjs/` when `official` is absent) ignores `requires.plugins` names that are neither of this package nor framework names. An official plugin may name another factory of the same package. An official plugin that names anything else is one finding. A plugin that installs its own system from `setup` is reported: `CameraCorePlugin` does this with `CameraSystem` (`packages/camera-core/src/camera-core-plugin.ts:70`, `packages/camera-core/src/camera-system.ts:35`), and that system is itself a plugin (`packages/core/src/system/runtime/define-system.ts:266`). Fix. Declare the hard requirement, pass framework plugins in `frameworkProviders`, and export a system as its own factory.

### CONFORMANCE:RUNTIME_SHAPE {#conformance-runtime-shape}

Cause. The export is not a function, the factory throws, the return is not a plugin, or the return has an own key that is not in `GWEN_PLUGIN_KEYS` (read from `@gwenjs/schema`). The message names the package and the export, and names the key when one is outside that list, for example `onUpdate`. One finding per offending factory. Other checks stay silent for that export. Fix. Export a function that returns a plugin, and remove that key. A frame hook belongs on a system or an actor, not on the plugin object.

### CONFORMANCE:RUNTIME_TEARDOWN {#conformance-runtime-teardown}

Cause. After `engine.stop()` (`packages/core/src/engine/gwen-engine.ts:247`), `hookListeners` is above the baseline from before `use`, a plugin name was added past that baseline, or a `provides` key is still injectable. An extra plugin name is one finding, and the message lists the baseline and the plugins after `stop`. `stop` runs `teardownAll` (`packages/core/src/engine/gwen-engine.ts:276`, `packages/core/src/engine/plugin-registry.ts:461`) and then `clearHooks` (`packages/core/src/engine/gwen-engine.ts:277`, `packages/core/src/engine/hook-tracker.ts:36`), including plugins installed as `frameworkProviders`, so the count can be lower than that baseline. It does not call `removeAllHooks` (`packages/core/src/engine/hook-dispatch.ts:254`). A listener or `provide` on the real engine from `useEngine()` therefore stays (`packages/core/src/engine/gwen-engine.ts:237`). `getStats()` stays readable after `stop` (`packages/core/src/engine/gwen-engine.ts:566`). Fix. Register hooks and `provide` on the `engine` argument of `setup`.

### CONFORMANCE:RUNTIME_TWO_ENGINES {#conformance-runtime-two-engines}

Cause. Two engines each install a new factory instance, and `tryInject` returns the same object for a `provides` key, or `unuse` on the first engine drops a key or the plugin of the second engine. The second engine then advances one frame. A shared service message names the key. A plugin that did not stay uses `lost "<name>" on the other engine`, and that message does not name a service key. When the first `use` rejects, this check stays silent. A hook that throws on that frame is one finding (`CORE:PLUGIN_RUNTIME_ERROR`), and the message includes the thrown text. Other events on that frame stay with the frames check. A logger copy of that event is not a second finding (`packages/core/src/engine/engine-error-policy.ts:407`). Fix. Create the service inside `setup`, so each engine holds its own object.

### CONFORMANCE:SNAPSHOT_MISMATCH {#conformance-snapshot-mismatch}

Cause. `public-api.snap.json` disagrees with the built types of `exports`: a value, a type or a subpath is in one and not in the other, or the file is missing, is not valid JSON, or has an invalid shape. The file lists, per subpath, the sorted `values` and `types`, in the gwen format. A subpath whose module entry is not built (its `types` file, else its `types.import` file, else its `import` file) is one finding. A subpath whose target names none of these files (for example `{ "default": "./dist/x.js" }`, a nested condition, or an array) is one finding too: `subpath "." declares no types or import file`. A `null` target blocks the subpath and is skipped. A target that is not a module entry (a `.wasm`, a `.css`) or a pattern (`./x/*`) is never required. The check reads the package and writes nothing, unless `--write` (CLI) or `write: true` (`checkPluginPackage`, `checkSnapshot`) is given: the file is then rewritten from the build before it is compared, in the gwen layout (2-space JSON, final newline, names sorted), and it is left untouched when it already holds the same names. The keys keep the order of the old file, a new subpath follows in `exports` order, and a subpath no longer in `exports` is dropped; with no old file the keys are in `exports` order. The file is replaced through a temp file, so a failed write keeps the old one; a write that fails is one finding, `public-api.snap.json cannot be written (<code>)`. A subpath whose target is not a module entry keeps its old entry. Nothing is written, and the findings are those of a read, while a subpath is not built or declares no types or import file, while `exports` names no subpath, or while the snapshot exists and cannot be read. `PRIVATE_EXPORT` is still reported after a write. In `checkPluginPackage`, it runs only when `exports` has no finding; `checkSnapshot` does not run the `exports` check. A snapshot file that exists but cannot be read (for example, a directory) is reported as `cannot be read (<code>)`, not as missing, with or without `--write`. Fix. Build the package, then run `gwen-conformance check --write` to update `public-api.snap.json`, or change the export.

### CONFORMANCE:TEST_MOCKS_FRAMEWORK {#conformance-test-mocks-framework}

Cause. A test file calls `mock` or `doMock` of `vi` with an `@gwenjs/` package other than the package itself, or `vitest.config.*` or `vite.config.*` at the package root has a `resolve.alias` or `test.alias` entry whose key is such a specifier (a string, a computed string, or a regular expression that starts with `@gwenjs/`; object and array forms are read). Test files are `*.test.*` and `*.spec.*` files, files under `tests`, `test` or `__tests__`, and `*.setup.*` files at the package root. Fix. Use the real package. To get an engine, boot one with `createRealEngine` from `@gwenjs/core/testing`, and remove the alias.
