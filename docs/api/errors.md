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

### CORE:OUTSIDE_SYSTEM_CONTEXT {#core-outside-system-context}

Cause. The call is outside `defineSystem()` or `defineActor()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_SCENE_CONTEXT {#core-outside-scene-context}

Cause. The call is outside `defineScene()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_LAYOUT_CONTEXT {#core-outside-layout-context}

Cause. The call is outside `defineLayout()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

### CORE:OUTSIDE_CLEANUP_CONTEXT {#core-outside-cleanup-context}

Cause. The call is outside `defineActor()`, `plugin setup()`, or `withCleanup()`. Fix. Capture the handle synchronously in the factory, then use it as a closure after await.

## @gwenjs/kit

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. Legacy `plugins`, `tsPlugins`, or `wasmPlugins` are set and `modules` is empty. Fix. Declare at least one `modules` entry.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. A resolved option is outside the range or shape `validateResolvedConfig` checks. Fix. Use a value the message names. `targetFPS` is from 30 to 240.

## @gwenjs/app

## @gwenjs/vite

## @gwenjs/math

## @gwenjs/physics2d

## @gwenjs/physics3d

## @gwenjs/renderer-core

### RENDERER:FOREIGN_LAYER_MANAGER {#renderer-foreign-layer-manager}

Cause. `getOrCreateLayerManager` found a `layerManager` value that is not this package's `LayerManager`. Fix. Remove that value and let `getOrCreateLayerManager` create the manager, or provide the `LayerManager` it created.

## @gwenjs/camera-core
