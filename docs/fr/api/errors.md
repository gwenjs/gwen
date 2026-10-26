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
- `CORE:TWEEN_POOL_EXHAUSTED` {#core-tween-pool-exhausted}
- `CORE:WASM_GLUE_MISMATCH` {#core-wasm-glue-mismatch} Lancé par le chargeur de glue WASM (#260).
- `CORE:ENGINE_DISPOSED` {#core-engine-disposed} Lancé par la libération du moteur (#261).
- `CORE:WASM_CAPACITY_EXHAUSTED` {#core-wasm-capacity-exhausted} Lancé par la capacité d'instance WASM (#263).

## @gwenjs/kit

- `KIT:MODULE_INVALID` {#kit-module-invalid}
- `KIT:PLUGIN_SETUP_FAILED` {#kit-plugin-setup-failed}

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. `plugins`, `tsPlugins` ou `wasmPlugins` sont définis et `modules` est vide. Fix. Déclarez au moins une entrée `modules`.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. Une option résolue est hors de la plage ou de la forme que vérifie `validateResolvedConfig`. Fix. Utilisez une valeur nommée par le message. `targetFPS` va de 30 à 240.

## @gwenjs/app

### APP:MODULE_SETUP_FAILED {#app-module-setup-failed}

Cause. Le `setup()` d'un module a levé une erreur. `cause` est cette erreur. Fix. Lisez le message de `cause` et corrigez le setup du module.

### APP:MODULE_LOAD_FAILED {#app-module-load-failed}

Cause. Le paquet ou le fichier du module n'a pas pu être importé, l'import n'a pas de `setup()` (`cause` est `KIT:MODULE_INVALID`), ou un `moduleLoader` personnalisé a levé une erreur. Fix. Vérifiez le nom et que le paquet est installé. En développement, un paquet manquant indique de lancer `gwen add <name>`.

### APP:CONFIG_LOAD_FAILED {#app-config-load-failed}

Cause. Aucun `gwen.config.ts` (ou `.js` / `.mjs` / `.cjs`) n'a été trouvé, ou le fichier a levé une erreur au chargement. Fix. Ajoutez le fichier de config, ou corrigez l'erreur de syntaxe nommée dans le message. Quand le fichier a levé, `cause` est cette erreur.

## @gwenjs/vite

### VITE:WASM_NOT_FOUND {#vite-wasm-not-found}

Cause. Le binaire WASM n'est pas au chemin résolu par le plugin. Fix. Lancez d'abord `cargo build --target wasm32-unknown-unknown`.

### VITE:OPTIMIZER_UNKNOWN_COMPONENT {#vite-optimizer-unknown-component}

Cause. Le générateur de code a demandé un composant absent du manifeste. Fix. Enregistrez le composant avant de générer le code bulk.

### VITE:OPTIMIZER_UNKNOWN_FIELD {#vite-optimizer-unknown-field}

Cause. Le champ n'est pas sur ce composant dans le manifeste. Fix. Utilisez un champ listé par le manifeste du composant.

## @gwenjs/math

### MATH:INVALID_HEX_COLOR {#math-invalid-hex-color}

Cause. `colorFromHex` a reçu une chaîne qui n'est pas `#RGB`, `#RGBA`, `#RRGGBB` ou `#RRGGBBAA`. Fix. Utilisez l'une de ces formes.

## @gwenjs/physics2d

## @gwenjs/physics3d

## @gwenjs/renderer-core

### RENDERER:ALREADY_REGISTERED {#renderer-already-registered}

Cause. Un nom de renderer est déjà enregistré. Fix. Retirez l'entrée de module en double dans `gwen.config.ts`.

### RENDERER:CONTRACT_VERSION {#renderer-contract-version}

Cause. `contractVersion` ne correspond pas à `RENDERER_CONTRACT_VERSION`. Fix. Mettez à jour le plugin renderer ou `@gwenjs/renderer-core` pour que les versions concordent.

### RENDERER:UNKNOWN_LAYER {#renderer-unknown-layer}

Cause. Un nom de calque n'est pas déclaré sur le renderer. Fix. Déclarez ce calque dans la config du renderer.

### RENDERER:LAYER_ORDER_CONFLICT {#renderer-layer-order-conflict}

Cause. Un calque surface partage son `order` avec un autre calque. Fix. Donnez au HUD un `order` strictement plus grand.

### RENDERER:MISSING_LAYER {#renderer-missing-layer}

Cause. Un renderer ne déclare aucun calque. Fix. Ajoutez au moins un calque.

### RENDERER:SURFACE_INVALID {#renderer-surface-invalid}

Cause. Un renderer surface ne déclare pas exactement un calque monde. Fix. Utilisez un calque avec `coordinate: "world"`.

### RENDERER:UNAVAILABLE_CAMERA {#renderer-unavailable-camera}

Cause. Aucune caméra active n'a été trouvée pour le viewport. Fix. Ajoutez un `Camera` avec `active: true` et enregistrez `CameraSystem`.

### RENDERER:SCREEN_TO_WORLD_PERSPECTIVE {#renderer-screen-to-world-perspective}

Cause. `screenToWorld` a été appelé avec une caméra perspective. Fix. Utilisez `screenToRay()`.

### RENDERER:FOREIGN_LAYER_MANAGER {#renderer-foreign-layer-manager}

Cause. `getOrCreateLayerManager` a trouvé une valeur `layerManager` qui n'est pas le `LayerManager` de ce package. Fix. Retirez cette valeur et laissez `getOrCreateLayerManager` créer le manager, ou fournissez le `LayerManager` qu'il a créé.

### RENDERER:CONFORMANCE_FAILED {#renderer-conformance-failed}

Cause. Un service renderer a échoué à `runConformanceTests` ou `runSurfaceConformance`. Fix. Mettez le plugin renderer au contrat `RendererService`.

### RENDERER:SCREEN_RESIZE_OBSERVER_NOT_AVAILABLE {#renderer-screen-resize-observer-not-available}

Cause. `ResizeObserver` est absent et aucun `sizeProvider` n'est défini. Fix. Passez `screen.sizeProvider` dans `gwen.config.ts`.

### RENDERER:SCREEN_VIEWPORT_NOT_FOUND {#renderer-screen-viewport-not-found}

Cause. L'id de viewport n'est pas enregistré. Fix. Déclarez-le sous `viewports` dans `gwen.config.ts`.

## @gwenjs/camera-core

### CAMERA:VIEWPORT_NOT_FOUND {#camera-viewport-not-found}

Cause. L'id de viewport n'est pas enregistré. Fix. Déclarez-le dans les viewports de `defineConfig`, ou appelez `useViewportManager().set()`.

Déclaré pour les consommateurs de camera. camera-core ne le lève jamais (`packages/camera-core/src/errors.ts`).

### CAMERA:EMPTY_PATH {#camera-empty-path}

Cause. `playPath()` a été appelé sans waypoint. Fix. Passez un tableau de waypoints non vide.

### CAMERA:PERSPECTIVE_FALLBACK {#camera-perspective-fallback}

Avertissement seulement. Déclaré sur `CameraErrorCodes` et jamais levé (`packages/camera-core/src/errors.ts`).

### CAMERA:PRIORITY_CONFLICT {#camera-priority-conflict}

Avertissement seulement. Déclaré sur `CameraErrorCodes` et jamais levé (`packages/camera-core/src/errors.ts`).
