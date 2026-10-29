---
title: Erreurs
---

# Erreurs

Un `GwenError` rend `[where] what`, puis `Fix: <hint>` quand `hint` est défini, puis `See <docsUrl> (<code>)`. Deux arguments utilisent `GWEN` comme `where`. `docsUrl` vaut `docsBase + "/api/errors#" + ancre`. `docsBase` est le champ statique `docsBase` de la classe, ou `https://gwenjs.github.io/gwen`. L'ancre met le code en minuscules et remplace `:` et `_` par `-`.

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
- `CORE:WASM_LOAD_ERROR` {#core-wasm-load-error} `initWasm` mappe `WebAssembly.LinkError` et `WebAssembly.CompileError` levés par `glue.initSync` vers ce code (`packages/core/src/engine/wasm-instance-provider.ts:58`). `cause` est cette erreur. Le message est le texte de l'erreur, écrit comme une phrase (`packages/core/src/engine/wasm-instance-provider.ts:59`).
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
- `CORE:PLUGIN_DEPENDENCY_MISSING` {#core-plugin-dependency-missing} `engine.use` rejeté parce qu'un plugin ou un service requis n'est pas installé.
- `CORE:PLUGIN_IN_USE` {#core-plugin-in-use} `engine.unuse` rejeté parce qu'un plugin installé exige encore ce plugin ou l'un de ses services.
- `CORE:TWEEN_POOL_EXHAUSTED` {#core-tween-pool-exhausted}
- `CORE:WASM_GLUE_MISMATCH` {#core-wasm-glue-mismatch} `checkGwenModule` rejette un module compilé qui ne correspond pas à sa glue. `init` appelle ce contrôle avant d'acquérir une instance (#263).

  | `reason` | Sens | `expected` | `actual` |
  | --- | --- | --- | --- |
  | `build` | Les ids de build diffèrent, ou `gwen.build` est absent ou répété. | `buildId` de la glue. | Texte de la section, `<no gwen.build section>`, ou `<n gwen.build sections>`. |
  | `fingerprint` | Les empreintes diffèrent, ou `gwen.fingerprint` est absente ou répétée. | Empreinte de la glue. | Texte de la section, `<no gwen.fingerprint section>`, ou `<n gwen.fingerprint sections>`. |
  | `exports` | Un nom de `rawExports` n'est pas un export du module. | Noms manquants joints par `,`. | `<absent>` |
  | `imports` | Le module importe un nom absent du contrat. | `<not in contract>` | Ces noms joints par `,`. |
- `CORE:ENGINE_DISPOSED` {#core-engine-disposed} Lancé par `createEngineLocal().get()` quand il créerait une valeur après le début de la libération par `engine.stop()`, et par `WasmBridgeImpl` après `engine.stop()`.
- `CORE:WASM_CAPACITY_EXHAUSTED` {#core-wasm-capacity-exhausted} Lancé par `initWasm`, depuis les fournisseurs d'instance (`packages/core/src/engine/wasm-instance-provider.ts:44`), quand `glue.initSync` lève un `RangeError` ou une valeur qui n'est pas une `Error` (`packages/core/src/engine/wasm-instance-provider.ts:45`). Le message est `Cannot create another WASM instance (mode "${mode}", ${live} live).` (`packages/core/src/engine/wasm-instance-provider.ts:48`). `cause` est la valeur levée (`packages/core/src/engine/wasm-instance-provider.ts:51`). En développement, `hint` est `Use wasmInstance: "shared", fewer engines per process, or worker threads.` (`packages/core/src/engine/wasm-instance-provider.ts:52`). Les recours sont `wasmInstance: "shared"`, moins de moteurs par processus, ou des worker threads.
- `CORE:INVALID_ENGINE` {#core-invalid-engine} Lancé par `createEngineLocal().get()` quand l'argument n'est pas un moteur.
- `CORE:ENGINE_LOCAL_REENTRANT` {#core-engine-local-reentrant} Lancé par `createEngineLocal().get()` quand `init` relit le même local pour le moteur qu'il construit.

## @gwenjs/kit

- `KIT:MODULE_INVALID` {#kit-module-invalid}
- `KIT:PLUGIN_SETUP_FAILED` {#kit-plugin-setup-failed}

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. Rien dans @gwenjs/schema ne lève ce code. La vérification est partie avec assertModuleFirstInput. Fix. Déclarez les modules dans gwen.config.ts. Une mauvaise entrée est APP:CONFIG_INVALID, venant de `resolveGwenConfig` dans `@gwenjs/app/resolve`.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. Rien dans @gwenjs/schema ne lève ce code. La vérification est partie avec validateResolvedConfig. Fix. Une erreur de plage dans gwen.config.ts est APP:CONFIG_INVALID, venant de `resolveGwenConfig` dans `@gwenjs/app/resolve`. Le chemin createEngine est CORE:INVALID_CONFIG.

## @gwenjs/app

### APP:MODULE_SETUP_FAILED {#app-module-setup-failed}

Cause. Le `setup()` d'un module a levé une erreur. `cause` est cette erreur. Fix. Lisez le message de `cause` et corrigez le setup du module.

### APP:MODULE_LOAD_FAILED {#app-module-load-failed}

Cause. Le paquet ou le fichier du module n'a pas pu être importé, l'import n'a pas de `setup()` (`cause` est `KIT:MODULE_INVALID`), ou un `moduleLoader` personnalisé a levé une erreur. Fix. Vérifiez le nom et que le paquet est installé. En développement, un paquet manquant indique de lancer `gwen add <name>`.

### APP:CONFIG_LOAD_FAILED {#app-config-load-failed}

Cause. Aucun `gwen.config.ts` (ou `.js` / `.mjs` / `.cjs`) n'a été trouvé, ou le fichier a levé une erreur au chargement. Fix. Ajoutez le fichier de config, ou corrigez l'erreur de syntaxe nommée dans le message. Quand le fichier a levé, `cause` est cette erreur.

### APP:CONFIG_INVALID {#app-config-invalid}

Cause. Un champ ne correspond pas à la forme attendue. `resolveGwenConfig` signale un champ de moteur, un `engine` ou un `logger` qui n'est pas un objet, une entrée de module en tuple, et une forme de variante. `GwenApp.setupModules` signale une clé top-level inconnue, une section de module qui n'est pas un objet, un problème de `validate`, et une valeur qui n'est pas sérialisable en JSON, y compris un cycle ou `undefined` dans un tableau. Le message nomme le chemin, la forme attendue et la valeur reçue. Un chemin de fichier vide s'écrit `Invalid gwen.config:` sans parenthèses. Fix. Utilisez une valeur nommée par le message.

### APP:CONFIG_CONFLICT {#app-config-conflict}

Cause. Un `engine.variant` explicite contredit un module de physique (`resolveGwenConfig`), deux modules partagent un `configKey`, ou un `configKey` est réservé (`GwenApp.setupModules`). Le message nomme les deux côtés. Fix. Gardez un seul propriétaire, ou réglez `engine.variant` sur la variante dérivée des modules.

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

### PHYSICS2D:STALE_ENTITY {#physics2d-stale-entity}

Cause. L'entité n'est plus vivante. Fix. Recréez-la avant l'appel.

### PHYSICS2D:STALE_BODY_HANDLE {#physics2d-stale-body-handle}

Cause. Le handle de corps n'a aucun propriétaire. Fix. Ajoutez le corps avant le collider.

### PHYSICS2D:INVALID_LAYERS {#physics2d-invalid-layers}

Cause. Bit de calque invalide, ou plus de 32 calques. Fix. Bits entiers de 0 à 31.

### PHYSICS2D:UNKNOWN_LAYER {#physics2d-unknown-layer}

Cause. Ce nom de calque n'est pas déclaré. Fix. Ajoutez-le à Physics2DConfig.layers.

### PHYSICS2D:INVALID_COLLIDER {#physics2d-invalid-collider}

Cause. Un collider de prefab n'a pas le rayon, la taille ou une forme connue. Fix. Passez ces champs.

### PHYSICS2D:WASM_VARIANT_MISMATCH {#physics2d-wasm-variant-mismatch}

Cause. Le WASM du core n'a pas la physique. Fix. Chargez une variante qui l'inclut.

### PHYSICS2D:INVALID_PREFAB_EXTENSION {#physics2d-invalid-prefab-extension}

Cause. L'extension de prefab n'a pas de tableau colliders. Fix. Posez extensions.physics.colliders.

### PHYSICS2D:POSITION_COMPONENT_REQUIRED {#physics2d-position-component-required}

Cause. positionComponent est absent. Fix. Passez-le à createPhysicsKinematicSyncSystem.

### PHYSICS2D:NOT_INITIALIZED {#physics2d-not-initialized}

Cause. Un export a tourné avant physics_init. Fix. Installez d'abord le plugin physics2d.

### PHYSICS2D:BODY_NOT_FOUND {#physics2d-body-not-found}

Cause. Aucun corps rigide n'est enregistré pour ce slot. Fix. Ajoutez un corps avant l'appel.

### PHYSICS2D:BODY_ALREADY_EXISTS {#physics2d-body-already-exists}

Cause. Ce slot a déjà un corps rigide. Fix. Retirez-le avant d'en ajouter un.

### PHYSICS2D:INVALID_BODY_KIND {#physics2d-invalid-body-kind}

Cause. Le type de corps n'est pas 0, 1 ou 2. Fix. Utilisez fixe, dynamique ou cinématique.

### PHYSICS2D:BUFFER_LENGTH_MISMATCH {#physics2d-buffer-length-mismatch}

Cause. Des tranches groupées n'ont pas la même longueur. Fix. Passez des tampons de même taille.

### PHYSICS2D:TILEMAP_CHUNK_ALREADY_LOADED {#physics2d-tilemap-chunk-already-loaded}

Cause. Ce chunk de tilemap est déjà chargé. Fix. Déchargez-le avant de le recharger.

### PHYSICS2D:TILEMAP_CHUNK_NOT_LOADED {#physics2d-tilemap-chunk-not-loaded}

Cause. Ce chunk de tilemap n'est pas chargé. Fix. Chargez-le avant de le décharger.

### PHYSICS2D:INVALID_PATH_REQUEST {#physics2d-invalid-path-request}

Cause. Une coordonnée ou une distance de chemin sort des limites. Fix. Envoyez une requête finie et valide.

### PHYSICS2D:INVALID_QUERY {#physics2d-invalid-query}

Cause. Une coordonnée ou un rayon de requête est refusé. Fix. Utilisez une valeur finie dans les bornes.

### PHYSICS2D:INVALID_STEP_DELTA {#physics2d-invalid-step-delta}

Cause. Un delta de pas n'est pas fini ou sort de 0 à 1. Fix. Restez dans cet intervalle.

## @gwenjs/physics3d

### PHYSICS3D:BVH_WORKER_TIMEOUT {#physics3d-bvh-worker-timeout}

Cause. Le worker BVH n'a pas répondu à temps. Fix. Réessayez ou réduisez le mesh.

### PHYSICS3D:BVH_CALLBACK_HANG {#physics3d-bvh-callback-hang}

Cause. Le code est déclaré et ce paquet ne le lance pas. Fix. Un worker en retard est BVH_WORKER_TIMEOUT.

### PHYSICS3D:MESH_FALLBACK {#physics3d-mesh-fallback}

Cause. L'avertissement est journalisé sans ce code : un mesh local devient une boîte. Fix. Utilisez un build WASM.

### PHYSICS3D:CONVEX_FALLBACK {#physics3d-convex-fallback}

Cause. L'avertissement est journalisé sans ce code : une coque convexe locale devient une boîte. Fix. Utilisez WASM.

### PHYSICS3D:STALE_ENTITY {#physics3d-stale-entity}

Cause. L'entité n'est plus vivante. Fix. Recréez-la avant l'appel.

### PHYSICS3D:UNKNOWN_LAYER {#physics3d-unknown-layer}

Cause. Ce nom de calque n'est pas dans le registre. Fix. Déclarez-le avant de résoudre les bits.

### PHYSICS3D:INVALID_COMPOUND {#physics3d-invalid-compound}

Cause. Les ids de formes diffèrent, une forme n'a pas été insérée, la longueur du tampon Rust n'est pas un multiple de 12, ou une partie a un type de forme inconnu. Fix. Alignez les longueurs.

### PHYSICS3D:BVH_LOAD_FAILED {#physics3d-bvh-load-failed}

Cause. Le fetch BVH, le worker ou l'export a échoué. Rust refuse aussi un tampon trop court, une magie autre que GBVH, une autre version de Rapier, ou une charge qui n'est pas un mesh valide. Fix. Vérifiez l'URL, le worker et le WASM.

### PHYSICS3D:NOT_INITIALIZED {#physics3d-not-initialized}

Cause. step() a tourné avant l'initialisation. Fix. Appelez setup avant step.

### PHYSICS3D:WASM_VARIANT_MISMATCH {#physics3d-wasm-variant-mismatch}

Cause. La variante active n'est pas physics3d, ou init manque. Fix. Passez variant physics3d.

### PHYSICS3D:INVALID_MESH_BUFFER {#physics3d-invalid-mesh-buffer}

Cause. Une longueur de positions ou d'indices n'est pas un multiple de 3. Fix. Passez des triplets.

### PHYSICS3D:NO_RIGID_BODY {#physics3d-no-rigid-body}

Cause. L'entité n'a pas encore de corps rigide. Fix. Appelez useDynamicBody ou useStaticBody d'abord.

### PHYSICS3D:MESH_REBUILD_FAILED {#physics3d-mesh-rebuild-failed}

Cause. La reconstruction du collider mesh a échoué. Fix. Vérifiez sommets, indices et corps.

### PHYSICS3D:BODY_NOT_FOUND {#physics3d-body-not-found}

Cause. Un export WASM n'a pas trouvé de corps pour ce slot. Fix. Ajoutez le corps d'abord.

### PHYSICS3D:BODY_ALREADY_EXISTS {#physics3d-body-already-exists}

Cause. Ce slot a déjà un corps rigide. Fix. Retirez-le avant d'en ajouter un.

### PHYSICS3D:INVALID_BODY_KIND {#physics3d-invalid-body-kind}

Cause. Le type de corps n'est pas 0, 1 ou 2. Fix. Utilisez fixe, dynamique ou cinématique.

### PHYSICS3D:BUFFER_LENGTH_MISMATCH {#physics3d-buffer-length-mismatch}

Cause. Des tranches d'un appel groupé n'ont pas la même longueur. Fix. Passez des tampons égaux.

### PHYSICS3D:COLLIDER_NOT_FOUND {#physics3d-collider-not-found}

Cause. Aucun collider n'est enregistré pour ce slot et cet id. Fix. Ajoutez-le avant l'appel.

### PHYSICS3D:COLLIDER_ALREADY_EXISTS {#physics3d-collider-already-exists}

Cause. Cet id de collider est déjà enregistré sur le slot. Fix. Choisissez un nouvel id.

### PHYSICS3D:INVALID_SHAPE {#physics3d-invalid-shape}

Cause. Les données de forme ne peuvent pas bâtir un collider. Fix. Vérifiez heightfield, mesh ou points.

### PHYSICS3D:JOINT_NOT_FOUND {#physics3d-joint-not-found}

Cause. Aucune jointure n'est enregistrée pour cet id. Fix. Créez la jointure avant de l'utiliser.

### PHYSICS3D:CHARACTER_CONTROLLER_NOT_FOUND {#physics3d-character-controller-not-found}

Cause. Aucun contrôleur de personnage n'est enregistré pour ce slot. Fix. Ajoutez-en un d'abord.

### PHYSICS3D:CHARACTER_CONTROLLER_LIMIT_REACHED {#physics3d-character-controller-limit-reached}

Cause. Le pool de contrôleurs de personnage est plein. Fix. Retirez-en un ou levez la limite.

### PHYSICS3D:NAVGRID_NOT_INITIALIZED {#physics3d-navgrid-not-initialized}

Cause. Une requête de chemin a tourné avant l'envoi de la grille. Fix. Envoyez la grille d'abord.

### PHYSICS3D:INVALID_NAVGRID {#physics3d-invalid-navgrid}

Cause. Les dimensions de grille sont nulles, débordent ou passent la limite. Fix. Réduisez la grille.

### PHYSICS3D:INVALID_PATH_REQUEST {#physics3d-invalid-path-request}

Cause. Une coordonnée de chemin n'est pas finie ou dépasse la cellule. Fix. Utilisez une cellule valide.

### PHYSICS3D:INVALID_COLLIDER {#physics3d-invalid-collider}

Cause. Une taille, un rayon ou une largeur de peau a été refusé. Fix. Passez une valeur finie acceptée.

### PHYSICS3D:INVALID_JOINT {#physics3d-invalid-joint}

Cause. Une ancre, un axe, un ressort, un moteur ou une limite n'est pas fini. Fix. Passez des nombres finis.

### PHYSICS3D:INVALID_QUERY {#physics3d-invalid-query}

Cause. Une coordonnée, une direction ou une distance a été refusée. Fix. Passez des valeurs finies.

### PHYSICS3D:INVALID_STEP_DELTA {#physics3d-invalid-step-delta}

Cause. Un delta de pas n'est pas fini ou sort de 0 à 1. Fix. Restez dans cet intervalle.

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
