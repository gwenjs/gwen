---
title: Erreurs
---

# Erreurs

Un troisième argument rend `[where] what`, puis `Fix: <hint>` quand `hint` est défini, puis `See <docsUrl> (<code>)`. Deux arguments gardent `what`. `docsUrl` vaut `docsBase + "/api/errors#" + ancre`. `docsBase` est le champ statique `docsBase` de la classe, ou `https://gwenjs.github.io/gwen`. L'ancre met le code en minuscules et remplace `:` et `_` par `-`.

Hors d'un contexte actif, capturez le handle avant un `await` :

```ts
// ✅ Capture handle synchronously in factory, use as closure after await
const transform = useTransform();
onStart(async () => {
  await loadAssets();
  transform.setPosition(400, 300); // closure — context not needed
});
```

## Espaces de noms

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

`RENDERER_THREE` lève `WEBGL_UNAVAILABLE`, `NOT_MOUNTED` et `OBJECT_ALREADY_ATTACHED`. `INSPECTOR` et `CONFORMANCE` n'ont aucun code sur cette page.

## Codes réservés

- `CORE:INTROSPECTION_PAGE_INVALID` {#core-introspection-page-invalid}
- `CORE:PLUGIN_EXTENSION_API_MISMATCH` {#core-plugin-extension-api-mismatch}
- `APP:PLUGIN_REQUIREMENT_MISSING` {#app-plugin-requirement-missing}
- `APP:PLUGIN_REQUIREMENT_ORDER` {#app-plugin-requirement-order}
- `APP:SERVICE_PROVIDER_MISSING` {#app-service-provider-missing}

## @gwenjs/core

### CORE:OUTSIDE_ENGINE_CONTEXT {#core-outside-engine-context}

Cause. L'appel est hors de `defineSystem()`, `defineActor()`, `defineScene()`, `plugin setup()` ou `engine.run()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

### CORE:OUTSIDE_ACTOR_CONTEXT {#core-outside-actor-context}

Cause. L'appel est hors de `defineActor()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

`useEntityId`, `useTransform`, `useChildren`, `useComponent`, `onStart`, `onDestroy`, `onRelease`, `onReset`, `onEnable` et `onDisable` lancent ce code. Les composables physique aussi : `useDynamicBody`, `useKinematicBody`, `useStaticBody`, `useShape`, `useBoxCollider`, `useSphereCollider`, `useCapsuleCollider`, `useConvexCollider`, `useMeshCollider`, `useHeightfieldCollider` et `useCompoundCollider`.

### CORE:OUTSIDE_SYSTEM_CONTEXT {#core-outside-system-context}

Cause. L'appel est hors de `defineSystem()` ou `defineActor()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

### CORE:OUTSIDE_SCENE_CONTEXT {#core-outside-scene-context}

Cause. L'appel est hors de `defineScene()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

### CORE:OUTSIDE_LAYOUT_CONTEXT {#core-outside-layout-context}

Cause. L'appel est hors de `defineLayout()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

`placeActor`, `placeGroup` et `placePrefab` lancent ce code.

### CORE:OUTSIDE_CLEANUP_CONTEXT {#core-outside-cleanup-context}

Cause. L'appel est hors de `defineActor()`, `plugin setup()` ou `withCleanup()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

## @gwenjs/kit

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. `plugins`, `tsPlugins` ou `wasmPlugins` sont définis et `modules` est vide. Fix. Déclarez au moins une entrée `modules`.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. Une option résolue est hors de la plage ou de la forme que vérifie `validateResolvedConfig`. Fix. Utilisez une valeur nommée par le message. `targetFPS` va de 30 à 240.

## @gwenjs/app

## @gwenjs/vite

## @gwenjs/math

## @gwenjs/physics2d

## @gwenjs/physics3d

## @gwenjs/renderer-core

### RENDERER:FOREIGN_LAYER_MANAGER {#renderer-foreign-layer-manager}

Cause. `getOrCreateLayerManager` a trouvé une valeur `layerManager` qui n'est pas le `LayerManager` de ce package. Fix. Retirez cette valeur et laissez `getOrCreateLayerManager` créer le manager, ou fournissez le `LayerManager` qu'il a créé.

## @gwenjs/camera-core
