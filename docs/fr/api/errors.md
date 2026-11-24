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
| `CONFORMANCE`    | `@gwenjs/plugin-conformance` (gwen)              | `ConformanceErrorCodes`   | `https://gwenjs.github.io/gwen`           |
| `AUDIO`          | gwenjs/audio                                     | —                         | `https://gwenjs.github.io/audio`          |
| `ASSETS`         | gwenjs/assets                                    | —                         | `https://gwenjs.github.io/assets`         |
| `RENDERER_THREE` | `@gwenjs/renderer-three` (gwenjs/renderer-three) | `RendererThreeErrorCodes` | `https://gwenjs.github.io/renderer-three` |
| `INSPECTOR`      | `@gwenjs/inspector` (gwenjs/inspector)           | `InspectorErrorCodes`     | `https://gwenjs.github.io/inspector`      |

`RENDERER_THREE` lève `WEBGL_UNAVAILABLE`, `NOT_MOUNTED` et `OBJECT_ALREADY_ATTACHED`. `INSPECTOR` n'a aucun code sur cette page.

## Codes réservés

- `CORE:INTROSPECTION_PAGE_INVALID` {#core-introspection-page-invalid}
- `APP:PLUGIN_REQUIREMENT_MISSING` {#app-plugin-requirement-missing}
- `APP:PLUGIN_REQUIREMENT_ORDER` {#app-plugin-requirement-order}
- `APP:SERVICE_PROVIDER_MISSING` {#app-service-provider-missing}

## @gwenjs/core

### CORE:HOOK_NAME_INVALID {#core-hook-name-invalid}

Cause. Le nom n'est pas `namespace:action` (`reason` `"format"`), ou `emit` / un `engine.hooks.callHook*` de plugin a utilisé un espace de noms réservé (`reason` `"reserved"`) : `engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, `service`. Fix. Utilisez `"namespace:action"`, par exemple `"enemy:died"`. Écoutez un nom réservé avec `useHook`. Émettez un nom de votre espace de noms, déclaré avec `defineHooks`.

### CORE:OUTSIDE_ENGINE_CONTEXT {#core-outside-engine-context}

Cause. L'appel est hors de `defineSystem()`, `defineActor()`, `defineScene()`, `plugin setup()` ou `engine.run()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

### CORE:OUTSIDE_ACTOR_CONTEXT {#core-outside-actor-context}

Cause. L'appel est hors de `defineActor()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

`useEntityId`, `useTransform`, `useChildren`, `useComponent` (forme à un argument), `onStart`, `onDestroy`, `onRelease`, `onReset`, `onEnable` et `onDisable` lancent ce code. Les composables physique aussi : `useDynamicBody`, `useKinematicBody`, `useStaticBody`, `useShape`, `useBoxCollider`, `useSphereCollider`, `useCapsuleCollider`, `useConvexCollider`, `useMeshCollider`, `useHeightfieldCollider` et `useCompoundCollider`.

### CORE:OUTSIDE_SYSTEM_CONTEXT {#core-outside-system-context}

Cause. L'appel est hors de `defineSystem()` ou `defineActor()`. Fix. Capturez la poignée dans la fabrique, puis utilisez-la comme closure après `await`.

`onBeforeUpdate`, `onUpdate`, `onAfterUpdate` et `onRender` lancent ce code. Ils le lancent aussi dans une fabrique `defineScene()` et dans le `setup()` d'un plugin : seul un système ou un acteur possède une boucle de frame.

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
- `CORE:DEFINITION_INCOMPLETE` {#core-definition-incomplete} `defineSystem(name)`, `defineComponent(name)`, `defineActor(name, prefab)` ou `defineActor(prefab)` a été appelé sans sa fonction setup ou sa factory. L'erreur est levée à l'installation du système, ou à l'appel de `defineComponent` et de `defineActor`. Elle est aussi levée quand `defineActor` reçoit ses arguments dans le mauvais ordre, ou une fonction en troisième argument.
- `CORE:INVALID_COMPONENT_TYPE` {#core-invalid-component-type}
- `CORE:INVALID_SCENE_ROUTE` {#core-invalid-scene-route} — `defineSceneRouter` lance `GwenSceneRouterError` quand `initial` ou une cible de transition n'est pas une clé de route.
- `CORE:SCENE_PRELOAD_FAILED` {#core-scene-preload-failed} — le rejet d'un gestionnaire `scene:preload` lance `GwenScenePreloadError` : `cause` est le premier rejet, la transition est annulée et la progression `1` n'est pas émise.
- `CORE:FRAME_LOOP_ERROR` {#core-frame-loop-error}
- `CORE:PLUGIN_SETUP_ERROR` {#core-plugin-setup-error}
- `CORE:PLUGIN_RUNTIME_ERROR` {#core-plugin-runtime-error}
- `CORE:WASM_LOAD_ERROR` {#core-wasm-load-error} `initWasm` mappe `WebAssembly.LinkError` et `WebAssembly.CompileError` levés par `glue.initSync` vers ce code (`packages/core/src/engine/wasm-instance-provider.ts:69`). `cause` est cette erreur. Le message est le texte de l'erreur, écrit comme une phrase (`packages/core/src/engine/wasm-instance-provider.ts:70`).
- `CORE:WASM_TIMEOUT` {#core-wasm-timeout}
- `CORE:WASM_PANIC` {#core-wasm-panic}
- `CORE:QUERY_CAPACITY_EXCEEDED` {#core-query-capacity-exceeded}
- `CORE:ENTITY_LIMIT_REACHED` {#core-entity-limit-reached}
- `CORE:COMPONENT_TYPE_LIMIT_REACHED` {#core-component-type-limit-reached} — enregistrer un type de composant de plus lance `GwenComponentLimitError`.
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
- `CORE:PLUGIN_INVALID_SHAPE` {#core-plugin-invalid-shape} `engine.use` a rejeté un plugin qui déclare une clé de cycle de vie que le moteur n'appelle jamais, un `extensionApi` invalide (`major` entier >= 1, `minor` entier >= 0), ou une entrée `requires.plugins` invalide (nom absent ou non textuel, `extensionApi` invalide, ou le même nom deux fois). `keys` nomme le champ.
- `CORE:PLUGIN_IN_USE` {#core-plugin-in-use} `engine.unuse` rejeté parce qu'un plugin installé exige encore ce plugin ou l'un de ses services.
- `CORE:PLUGIN_EXTENSION_API_MISMATCH` {#core-plugin-extension-api-mismatch} `engine.use` a rejeté une extension parce qu'une base installée a un majeur d'API d'extension différent, un mineur plus bas, ou aucune. `mismatches` liste chaque base. `setup` n'a pas été appelé et rien n'est parti sur `engine.errors`.
- `CORE:PLUGIN_OPTIONS_INVALID` {#core-plugin-options-invalid} `engine.use` a rejeté un plugin dont `validateOptions()` a renvoyé des problèmes. `setup` n'a pas été appelé et rien n'est parti sur `engine.errors`. Le message liste une ligne par problème.
- `CORE:PLUGIN_PROVIDE_DUPLICATE` {#core-plugin-provide-duplicate} `engine.use` a rejeté un plugin qui déclare dans `provides` une clé déjà tenue par un plugin installé, par un plugin en cours d'installation ou par le moteur. `owner` est le nom de ce plugin, ou `<engine>`.
- `CORE:PLUGIN_PROVIDE_UNDECLARED` {#core-plugin-provide-undeclared} `provide` sur le moteur de `setup` a reçu une clé que le plugin n'a pas déclarée dans `provides`. L'erreur part du moteur de `setup`, donc `setup` échoue par le chemin normal.
- `CORE:PLUGIN_PROVIDE_MISSING` {#core-plugin-provide-missing} `setup` s'est terminé sans fournir toutes les clés déclarées dans `provides`. Le plugin est retiré et `teardown` s'exécute. Aucun `CORE:PLUGIN_SETUP_ERROR` n'est émis.
- `CORE:TWEEN_POOL_EXHAUSTED` {#core-tween-pool-exhausted} Levée par `TweenPool.claim`, et par `useSequence` quand une étape d'attente ne peut pas prendre un emplacement parce que le pool `'drop'` est épuisé.
- `CORE:WASM_GLUE_MISMATCH` {#core-wasm-glue-mismatch} `checkGwenModule` rejette un module compilé qui ne correspond pas à sa glue. `init` appelle ce contrôle avant d'acquérir une instance (#263).

  | `reason`      | Sens                                                                    | `expected`                     | `actual`                                                                                  |
  | ------------- | ----------------------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
  | `build`       | Les ids de build diffèrent, ou `gwen.build` est absent ou répété.       | `buildId` de la glue.          | Texte de la section, `<no gwen.build section>`, ou `<n gwen.build sections>`.             |
  | `fingerprint` | Les empreintes diffèrent, ou `gwen.fingerprint` est absente ou répétée. | Empreinte de la glue.          | Texte de la section, `<no gwen.fingerprint section>`, ou `<n gwen.fingerprint sections>`. |
  | `exports`     | Un nom de `rawExports` n'est pas un export du module.                   | Noms manquants joints par `,`. | `<absent>`                                                                                |
  | `imports`     | Le module importe un nom absent du contrat.                             | `<not in contract>`            | Ces noms joints par `,`.                                                                  |

- `CORE:ENGINE_DISPOSED` {#core-engine-disposed} Lancé par `createEngineLocal().get()` quand il créerait une valeur après le début de la libération par `engine.stop()`, et par `WasmBridgeImpl` après `engine.stop()`.
- `CORE:WASM_CAPACITY_EXHAUSTED` {#core-wasm-capacity-exhausted} Lancé par `initWasm`, depuis les fournisseurs d'instance (`packages/core/src/engine/wasm-instance-provider.ts:57`), quand `glue.initSync` lève un `RangeError` ou une valeur qui n'est pas une `Error` (`packages/core/src/engine/wasm-instance-provider.ts:58`). Le message est `Cannot create another WASM instance (mode "${mode}", ${live} live).` (`packages/core/src/engine/wasm-instance-provider.ts:61`). `cause` est la valeur levée (`packages/core/src/engine/wasm-instance-provider.ts:64`). En développement, `hint` est `Use wasmInstance: "shared", fewer engines per process, or worker threads.` (`packages/core/src/engine/wasm-instance-provider.ts:65`). Les recours sont `wasmInstance: "shared"`, moins de moteurs par processus, ou des worker threads. `mode` ne vaut `"auto"` que si l'instance du pool elle-même ne peut pas être créée (`packages/core/src/engine/wasm-instance-provider.ts:185`) ; sinon `auto` rejoint le pool.
- `CORE:INVALID_ENGINE` {#core-invalid-engine} Lancé par `createEngineLocal().get()` quand l'argument n'est pas un moteur.
- `CORE:ENGINE_LOCAL_REENTRANT` {#core-engine-local-reentrant} Lancé par `createEngineLocal().get()` quand `init` relit le même local pour le moteur qu'il construit.

## @gwenjs/kit

- `KIT:MODULE_INVALID` {#kit-module-invalid} Levé par `defineGwenModule()` quand `meta`, `meta.name`, `meta.configKey`, `meta.version`, `defaults`, `setup` ou `validate` est invalide. `fields` liste chaque chemin en échec. Le message nomme ces champs.
- `KIT:PLUGIN_SETUP_FAILED` {#kit-plugin-setup-failed} Cause. Plus rien dans @gwenjs/kit ne lève ce code ; `definePlugin` n'enveloppe plus `setup`, et un échec de setup est `CORE:PLUGIN_SETUP_ERROR` (ancre #core-plugin-setup-error).

## @gwenjs/schema

### SCHEMA:MODULES_REQUIRED {#schema-modules-required}

Cause. Rien dans @gwenjs/schema ne lève ce code. La vérification est partie avec assertModuleFirstInput. Fix. Déclarez les modules dans gwen.config.ts. Une mauvaise entrée est APP:CONFIG_INVALID, venant de `resolveGwenConfig` dans `@gwenjs/app/resolve`.

### SCHEMA:INVALID_CONFIG {#schema-invalid-config}

Cause. Rien dans @gwenjs/schema ne lève ce code. La vérification est partie avec validateResolvedConfig. Fix. Une erreur de plage dans gwen.config.ts est APP:CONFIG_INVALID, venant de `resolveGwenConfig` dans `@gwenjs/app/resolve`. Le chemin createEngine est CORE:INVALID_CONFIG.

## @gwenjs/app

### APP:MODULE_SETUP_FAILED {#app-module-setup-failed}

Cause. Le `setup()` d'un module a levé une erreur. `cause` est cette erreur. Fix. Lisez le message de `cause` et corrigez le setup du module.

### APP:MODULE_LOAD_FAILED {#app-module-load-failed}

Cause. Le paquet ou le fichier du module n'a pas pu être importé, l'import échoue à la validation du module (`cause` est `KIT:MODULE_INVALID` et nomme les champs), ou un `moduleLoader` personnalisé a levé une erreur. Un paquet sans export `./module` est `APP:MODULE_ENTRY_MISSING`. Fix. Vérifiez le nom et que le paquet est installé. En développement, un paquet manquant indique de lancer `gwen add <name>`.

### APP:MODULE_ENTRY_MISSING {#app-module-entry-missing}

Cause. Un paquet de module ne déclare pas d'export `./module`. Le message nomme le paquet. Fix. Exportez `./module` (`defineGwenModule`), ou retirez le paquet de `modules`.

### APP:PLUGIN_NOT_DECLARATIVE {#app-plugin-not-declarative}

Cause. `kit.addPlugin()` a reçu quelque chose qui n'est pas une `PluginDeclaration { src, export?, options? }` (une instance, une fonction, ou un objet sans `src` de type chaîne), ou les `options` ne sont pas sérialisables en JSON (message `Plugin declaration "<src>" has options that are not JSON-serializable.`). L'échec est enveloppé dans `APP:MODULE_SETUP_FAILED`, dont le `cause` est cette erreur. Fix. Déclarez le paquet et son export, `kit.addPlugin({ src: "<pkg>", export: "<Factory>", options })`, et ne passez que des données JSON.

### APP:CONFIG_LOAD_FAILED {#app-config-load-failed}

Cause. Aucun `gwen.config.ts` (ou `.js` / `.mjs` / `.cjs`) n'a été trouvé, ou le fichier a levé une erreur au chargement. Fix. Ajoutez le fichier de config, ou corrigez l'erreur de syntaxe nommée dans le message. Quand le fichier a levé, `cause` est cette erreur.

### APP:CONFIG_INVALID {#app-config-invalid}

Cause. Un champ ne correspond pas à la forme attendue. `resolveGwenConfig` signale un champ de moteur, un `engine` ou un `logger` qui n'est pas un objet, une entrée de module en tuple, et une forme de variante. `GwenApp.setupModules` signale une clé top-level inconnue, une section de module qui n'est pas un objet, un problème de `validate`, et une valeur qui n'est pas sérialisable en JSON, y compris un cycle ou `undefined` dans un tableau. Le message nomme le chemin, la forme attendue et la valeur reçue. Un chemin de fichier vide s'écrit `Invalid gwen.config:` sans parenthèses. Fix. Utilisez une valeur nommée par le message.

### APP:CONFIG_CONFLICT {#app-config-conflict}

Cause. Un `engine.variant` explicite contredit un module de physique (`resolveGwenConfig`), deux modules partagent un `configKey`, ou un `configKey` est réservé (`GwenApp.setupModules`). Le message nomme les deux côtés. Fix. Gardez un seul propriétaire, ou réglez `engine.variant` sur la variante dérivée des modules.

## @gwenjs/vite

### VITE:OPTIMIZER_UNKNOWN_COMPONENT {#vite-optimizer-unknown-component}

Cause. Le générateur de code a demandé un composant absent du manifeste. Fix. Enregistrez le composant avant de générer le code bulk.

### VITE:OPTIMIZER_UNKNOWN_FIELD {#vite-optimizer-unknown-field}

Cause. Le champ n'est pas sur ce composant dans le manifeste. Fix. Utilisez un champ listé par le manifeste du composant.

### VITE:SCENE_NAME_UNRESOLVED {#vite-scene-name-unresolved}

Cause. `scanScenes` (`packages/vite/src/scanners/index.ts:118`) a lu un fichier sous `src/scenes/` dont le nom de scène n'est pas un littéral. Le message est `Scene file "${rel}" has no literal scene name.` (`packages/vite/src/scanners/index.ts:138`). Un fichier dont le nom commence par `_` ou `.` est ignoré (`packages/vite/src/scanners/index.ts:126`). Fix. Appelez `defineScene` avec un littéral, ou préfixez un fichier d'aide par `_`.

### VITE:SCENE_NAME_DUPLICATE {#vite-scene-name-duplicate}

Cause. Deux fichiers de scène déclarent le même littéral. Le message est `Scene name "${sceneName}" is declared in "${previous}" and "${rel}".` (`packages/vite/src/scanners/index.ts:153`). Fix. Donnez à chaque fichier son propre littéral.

### VITE:MAIN_SCENE_UNKNOWN {#vite-main-scene-unknown}

Cause. `resolveMainScene` (`packages/vite/src/scanners/index.ts:183`) a reçu un `mainScene` qui n'est pas un nom découvert. Le message liste ces noms (`packages/vite/src/scanners/index.ts:192`). Sans `mainScene`, la première scène découverte est utilisée (`packages/vite/src/scanners/index.ts:204`). Fix. Réglez `mainScene` sur un nom découvert sous `src/scenes/`.

### VITE:TRANSFORM_PARSE_FAILED {#vite-transform-parse-failed}

Cause. `parseModule` n'a pas pu analyser le module. Le message commence par l'id, la ligne et la colonne, toutes deux à base 1. `loc.column` est à base 0, comme Vite la lit. Fix. Corrigez l'erreur de syntaxe ; le build GWEN ne saute jamais un module qu'il ne peut pas analyser.

### VITE:TRANSFORM_EDIT_CONFLICT {#vite-transform-edit-conflict}

Cause. Deux unités éditent des plages qui se chevauchent dans un module. Le message nomme les deux unités et les plages. Une insertion exactement au début ou à la fin d'une autre édition n'est pas un chevauchement. Deux insertions au même offset suivent l'ordre du registre. Fix. Déplacez une édition pour que les plages ne se chevauchent plus.

### VITE:TRANSFORM_UNSUPPORTED {#vite-transform-unsupported}

Cause. Quatre sites de levée. `register()` a été appelé après le `buildStart` de `gwen:transform-pipeline`. `register()` a été appelé avec une unité différente sous un nom déjà pris. Le message est `register() was called with a different unit named …`. `useActor(Y)` dans un factory d'acteur, quand `Y` n'est pas une liaison de portée module, ou quand `Y` est un `const`, un `let`, un `var` ou une `class` déclaré après cet acteur. Un `await` imbriqué dans l'argument d'un `await` de `onEnter`, `onExit` ou `withAsyncContext`. Fix. `register()` est accepté jusqu'au `buildStart`, par exemple depuis le `configResolved` de n'importe quel plugin. Enregistrez un seul objet d'unité par nom. Déclarez `Y` à la portée du module, avant l'acteur, ou passez-le par les arguments du factory. Assignez d'abord l'await intérieur à un const.

### VITE:BVH_PREBAKE_FAILED {#vite-bvh-prebake-failed}

Cause. Déclaré dans `ViteErrorCodes` pour l'étape ultérieure de précalcul BVH. Ce code n'a pas encore de site de levée. Fix. Lisez le message de précalcul quand cette étape le lèvera.

## @gwenjs/math

### MATH:INVALID_HEX_COLOR {#math-invalid-hex-color}

Cause. `colorFromHex` a reçu une chaîne qui n'est pas `#RGB`, `#RGBA`, `#RRGGBB` ou `#RRGGBBAA`. Fix. Utilisez l'une de ces formes.

## @gwenjs/physics2d

### PHYSICS2D:STALE_ENTITY {#physics2d-stale-entity}

Cause. L'entité n'est plus vivante. Fix. Recréez-la avant l'appel.

### PHYSICS2D:STALE_BODY_HANDLE {#physics2d-stale-body-handle}

Cause. Le code reste dans `Physics2DErrorCodes` (`packages/physics2d/src/errors.ts:11`) et `Physics2DStaleBodyHandleError` reste exporté (`packages/physics2d/src/errors.ts:64`). Le plugin ne lève pas cette classe. Un collider sur une entité sans corps rigide lève `PHYSICS2D:BODY_NOT_FOUND` (`packages/physics2d/src/plugin/index.ts:297`). Un appel sur une entité qui n'est plus vivante lève `PHYSICS2D:STALE_ENTITY` (`packages/physics2d/src/plugin/index.ts:283`). Les exports WASM `physics_add_box_collider` et `physics_add_ball_collider` renvoient encore `PHYSICS2D:STALE_BODY_HANDLE` quand le handle numérique n'est pas enregistré (`crates/gwen-core/src/physics2d/world.rs:281`, `crates/gwen-core/src/physics2d/world.rs:370`). `callPhysicsExport` transmet chaque code `PHYSICS2D:` (`packages/physics2d/src/plugin/index.ts:321`, `packages/physics2d/src/plugin/index.ts:325`), donc ce code peut encore atteindre l'appelant.

### PHYSICS2D:INVALID_LAYERS {#physics2d-invalid-layers}

Cause. Le code reste dans `Physics2DErrorCodes` (`packages/physics2d/src/errors.ts:9`). Un bit de calque invalide, ou plus de 32 calques, n'est plus levé sous ce code. `checkPhysics2DConfig` (`packages/physics2d/src/config.ts:57`) les signale comme problèmes de `CORE:PLUGIN_OPTIONS_INVALID` : chemin `layers.<name>` pour un bit (`packages/physics2d/src/config.ts:46`), chemin `layers` au-delà de 32 calques (`packages/physics2d/src/config.ts:62`). `engine.use` rejette avant `setup`. Fix. Bits entiers de 0 à 31, et au plus 32 calques.

### PHYSICS2D:UNKNOWN_LAYER {#physics2d-unknown-layer}

Cause. Ce nom de calque n'est pas déclaré. Fix. Ajoutez-le à Physics2DConfig.layers.

### PHYSICS2D:INVALID_COLLIDER {#physics2d-invalid-collider}

Cause. Un collider de prefab n'a pas le rayon, la taille ou une forme connue. Fix. Passez ces champs.

### PHYSICS2D:WASM_VARIANT_MISMATCH {#physics2d-wasm-variant-mismatch}

Cause. Le WASM du core n'a pas la physique. Fix. Chargez une variante qui l'inclut.

### PHYSICS2D:INVALID_PREFAB_EXTENSION {#physics2d-invalid-prefab-extension}

Cause. L'extension de prefab n'a pas de tableau colliders. Fix. Posez extensions.physics2d.colliders.

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

### PHYSICS2D:VITE_PIPELINE_MISSING {#physics2d-vite-pipeline-missing}

Cause. La config Vite n'a pas gwen:transform-pipeline. Fix. Ajoutez gwen() de @gwenjs/vite à la config Vite.

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

### PHYSICS3D:INVALID_LAYERS {#physics3d-invalid-layers}

Cause. `buildLayerRegistry` (`packages/physics3d/src/config.ts`) a reçu plus de 32 calques, ou un bit qui n'est pas un entier de `0` à `31`. Le registre partagé signale `LAYER_LIMIT` ou `LAYER_BIT_RANGE` (`packages/physics-core/src/layer-registry.ts:34-46`). Le plugin mappe les deux sur ce code (`packages/physics3d/src/config.ts:78-80`, `packages/physics3d/src/errors/codes.ts:13`). Fix. Utilisez un bit entier de 0 à 31, et 32 calques au plus.

### PHYSICS3D:UNKNOWN_LAYER {#physics3d-unknown-layer}

Cause. Ce nom de calque n'est pas dans le registre. Fix. Déclarez-le avant de résoudre les bits.

### PHYSICS3D:UNKNOWN_MATERIAL {#physics3d-unknown-material}

Cause. Ce nom de matériau n'est pas `default`, `ice`, `rubber` ou `metal`. Fix. Utilisez l'un de ces noms. Résolu sur le backend WASM seulement.

### PHYSICS3D:INVALID_COMPOUND {#physics3d-invalid-compound}

Cause. Les ids de formes diffèrent, une forme n'a pas été insérée, la longueur du tampon Rust n'est pas un multiple de 12, ou une partie a un type de forme inconnu. Fix. Alignez les longueurs.

### PHYSICS3D:BVH_LOAD_FAILED {#physics3d-bvh-load-failed}

Cause. Le fetch BVH, le worker ou l'export a échoué, ou un tampon de mesh est en mémoire partagée, qui ne peut pas être transféré au worker. Rust refuse aussi un tampon trop court, une magie autre que GBVH, une autre version de Rapier, ou une charge qui n'est pas un mesh valide. Fix. Vérifiez l'URL, le worker et le WASM.

### PHYSICS3D:NOT_INITIALIZED {#physics3d-not-initialized}

Cause. step() a tourné avant l'initialisation, ou bulkSpawnStaticBoxes() a tourné alors que le plugin n'a plus de moteur (après le teardown). Fix. Appelez setup avant step, et n'utilisez pas un service conservé après le teardown.

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

### PHYSICS3D:VITE_PIPELINE_MISSING {#physics3d-vite-pipeline-missing}

Cause. La config Vite n'a pas gwen:transform-pipeline. Fix. Ajoutez gwen() de @gwenjs/vite à la config Vite.

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

Cause. `getOrCreateLayerManager` a trouvé une valeur `layerManager` qui n'est pas le `LayerManager` de ce package. Fix. Retirez cette valeur. `gwen:viewports` fournit le `LayerManager` créé par ce package.

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

## @gwenjs/plugin-conformance

### CONFORMANCE:ATTW {#conformance-attw}

Cause. `attw --pack --profile esm-only` signale un problème sur l'archive que `npm pack` fait du paquet. Un constat par type de problème et par point d'entrée, avec les résolutions en échec, par exemple `UntypedResolution at "./module" (node16-esm, bundler)`. Un problème qui nomme un fichier et aucun point d'entrée donne un constat par type de problème et par fichier, par exemple `FalseCJS in "dist/index.d.cts"`. Le profil ignore `node10` et `node16-cjs`. L'archive est faite avec `npm pack --ignore-scripts` : les scripts de cycle de vie ne s'exécutent pas, à la différence de `attw --pack`. Le `.attw.json` du paquet est ignoré : attw s'exécute hors du paquet, un paquet ne peut donc pas exclure ses propres points d'entrée. Il est aussi signalé quand `npm pack` échoue (`npm` doit être dans le `PATH`), quand la sortie d'attw est illisible, ou quand le paquet ne livre aucun type. La vérification ne s'exécute que si `exports` n'a aucun constat. Fix. Suivez le lien de l'indice, et faites que `exports` et les fichiers `.d.ts` résolvent leurs types pour chaque point d'entrée.

### CONFORMANCE:AUGMENT_TARGET {#conformance-augment-target}

Cause. Un bloc `declare module` nomme un paquet du framework autre que `@gwenjs/schema` (par exemple `@gwenjs/core` ou `@gwenjs/kit`), ou un bloc `declare module "@gwenjs/schema"` ajoute à `GwenProvides` une clé que le framework déclare déjà (le message nomme la clé et le paquet qui la déclare). Le nom du paquet lui-même et ses sous-chemins ne sont pas signalés. Chaque fichier script de `src`, chaque fichier de déclaration (`.d.ts`, `.d.mts`, `.d.cts`) sous `src` ou sous un dossier `tests`, `test` ou `__tests__`, et chaque fichier de test est lu, avec l'API TypeScript : un `declare module` dans un commentaire n'est pas lu. `dist` n'est pas lu. La liste des clés est générée depuis les sources du framework, comme `FRAMEWORK_ENTRIES`. Pour un paquet communautaire, le même code est aussi signalé quand un bloc `declare module "@gwenjs/schema"` ajoute une clé de `GwenProvides`, `GwenRuntimeHooks` ou `GwenPluginRegistry` que la déclaration `./extension` d'une base installée déclare déjà. La déclaration `./extension` de la base est lue comme de la syntaxe, et les fichiers de déclaration qu'elle référence dans le répertoire de la base sont suivis. Le message nomme l'interface, la clé et la base. Un constat par clé. Quand une clé de `GwenProvides` est aussi une clé du framework, c'est le message du framework qui est signalé. Un paquet officiel n'est pas comparé à ses bases. Une clé que la base ne déclare pas n'est pas signalée. Une base qui ne peut pas être résolue, ou dont le `package.json` ne peut pas être analysé, n'ajoute aucune clé. Fix. Augmentez plutôt `@gwenjs/schema` (`GwenProvides`, `GwenRuntimeHooks`), et choisissez une clé de service qui vous est propre, par exemple `"<plugin>:<service>"`. Une clé qu'une base installée déclare déjà exige une clé qui vous est propre : un service `"<plugin>:<service>"`, un hook `"<plugin>:<event>"`, ou une clé de registre.

### CONFORMANCE:BASE_NOT_EXTENSIBLE {#conformance-base-not-extensible}

Cause. Un nom de paquet retenu de `gwen.extends` (un nom de paquet valide, unique, et autre que celui de ce paquet, nom de paquet du framework compris) ne peut pas être résolu depuis `node_modules` (la racine du paquet et ses ancêtres), son `package.json` installé ne peut pas être analysé, `exports` n'a pas d'entrée `"./extension"`, ou il n'a pas de `gwen.hookNamespace`. Une chaîne et un objet de conditions comptent tous deux comme une entrée `"./extension"`. Un constat par base et par problème, sur la ligne de cet élément dans `package.json`. Une base qui ne peut pas être résolue ou analysée produit ce seul constat et n'est pas vérifiée plus loin. La vérification s'exécute pour les deux profils. Fix. Installez la base, donnez-lui un `package.json` qui s'analyse, exportez `"./extension"` comme une chaîne ou un objet de conditions, et réglez `gwen.hookNamespace`.

### CONFORMANCE:DEV_PIN {#conformance-dev-pin}

Cause. Un paquet du framework (une clé de `FRAMEWORK_RANGES`) est listé dans `devDependencies` avec un spécificateur qui n'est pas une version exacte. Une version exacte est `majeur.mineur.correctif`, avec une pré-version et un build facultatifs, par exemple `1.0.0-integration.20261123120000.gabc1234`. Une plage (`^`, `~`, `*`, `latest`, `>=`, `1.x`), un spécificateur `workspace:`, un spécificateur `file:` ou un alias `npm:` n'est pas exact. Une dépendance de développement absente n'est pas un constat. Un constat par paquet, sur la ligne de la clé dans `package.json`. La vérification s'exécute pour les deux profils. Fix. Épinglez le paquet dans `devDependencies` sur la version exacte contre laquelle les tests s'exécutent.

### CONFORMANCE:EXPORTS_INVALID {#conformance-exports-invalid}

Cause. Une cible `exports` qui est une chaîne doit commencer par `./` et être un fichier du paquet. Une cible qui n'est ni une chaîne, ni un tableau, ni un objet, ni `null` est refusée. `null` est ignoré. `exports` absent, qui n'est pas un objet, ou vide est refusé, ainsi qu'un mélange de clés de sous-chemin et de clés de condition. Dans un objet de conditions, `types` doit être la première clé. `./internal`, `./internal/…` et une clé qui commence par `./internal*` sont refusés. Le profil `plugin` exige aussi `.` et `./module`. Un motif (`*`) n'est pas vérifié sur le disque. Fix. Faites commencer chaque cible chaîne par `./` vers un fichier du paquet, gardez `exports` comme un objet non vide d'une seule forme, mettez `types` en premier, retirez les sous-chemins internes, et ajoutez `.` et `./module` pour un plugin.

### CONFORMANCE:EXTENSION_ENTRY {#conformance-extension-entry}

Cause. Un paquet communautaire importe un paquet listé tel quel dans `gwen.extends`, et le spécificateur n'est pas `<base>/extension`. Un segment `internal` ou `wasm` reste `IMPORT_INTERNAL`, y compris dans un fichier de `dist`. Un segment `dist` ou `src` reste `IMPORT_DEEP`. La racine du paquet et tout autre sous-chemin, y compris `<base>/testing`, `<base>/module`, `<base>/extension/sub` et `<base>/extension.js`, sont `EXTENSION_ENTRY`. Un fichier de test peut importer la racine et `<base>/testing`. Dans `dist`, seul un spécificateur interne est signalé. La base est un nom de paquet, ni un paquet du framework ni un paquet interdit. Un paquet officiel garde `IMPORT_FOREIGN_PLUGIN`. Un constat par ligne d'import. Fix. N'importez que `<base>/extension` depuis une base.

### CONFORMANCE:EXTENSION_OFFICIAL {#conformance-extension-official}

Cause. Un paquet officiel (son nom commence par `@gwenjs/` et ce n'est pas un paquet du framework) liste au moins un nom de paquet valide, unique, et autre que le sien dans `gwen.extends`. Un constat, sur la ligne de la clé `gwen.extends` dans `package.json`. Le message nomme le paquet et chaque base listée. Un paquet communautaire, un paquet du framework, un `gwen.extends` absent, un tableau vide, et une valeur qui n'est pas un tableau sont acceptés. Une entrée qui n'est pas une chaîne, un nom répété, le nom du paquet lui-même, et une valeur qui n'est pas un nom de paquet sont laissés hors de ce message. La vérification s'exécute pour les deux profils. Fix. Retirez `gwen.extends`. Un paquet officiel ne nomme que les plugins de son propre paquet et les plugins du framework : utilisez `requires.services` ou `requires.optional` sur les contrats de schéma.

### CONFORMANCE:EXTENSION_PEER {#conformance-extension-peer}

Cause. Un nom de paquet retenu de `gwen.extends` (un nom de paquet valide, unique, et autre que celui de ce paquet) est absent de `peerDependencies`, est aussi listé dans `dependencies` ou `optionalDependencies`, a une plage de pair qui n'est pas une plage semver utilisable, ou n'a pas d'épingle exacte dans `devDependencies` à l'intérieur de cette plage. Un pair absent est signalé sur la ligne de l'élément `gwen.extends`. Une entrée de `dependencies` ou `optionalDependencies` est signalée sur la ligne de cette clé. Une plage inutilisable (`*`, `x`, `X`, `x.x.x`, `>=0.0.0` ou `>=0.0.0-0` après normalisation, un spécificateur vide, `latest`, ou un spécificateur `workspace:`, `file:`, `link:` ou `npm:`) est signalée sur la ligne de la clé du pair, et l'épingle n'est pas vérifiée. Une plage utilisable sans épingle exacte est signalée sur la ligne de l'élément `gwen.extends`. Une épingle qui n'est pas une version exacte, ou qui ne satisfait pas la plage (préversion comprise), est signalée sur la ligne de la clé `devDependencies`. Un constat par base et par problème. Une section qui n'est pas un objet est ignorée. La vérification s'exécute pour les deux profils. Fix. Déclarez la base dans `peerDependencies` sur une plage semver utilisable, gardez-la hors de `dependencies` et `optionalDependencies`, et épinglez une version exacte à l'intérieur de cette plage dans `devDependencies`.

### CONFORMANCE:HOOK_DYNAMIC_NAME {#conformance-hook-dynamic-name}

Cause. Le nom passé à `emit`, `callHook`, `callHookParallel` ou `callHookWith` n'est ni une chaîne littérale, ni un gabarit sans substitution, ni un identifiant qui désigne une `const` chaîne littérale du même fichier : la vérification ne peut pas le lire. Un constat par appel. Un appel par alias (`const fire = engine.hooks.callHook`) n'est pas un site d'émission et n'est pas vérifié. Fix. Passez une chaîne littérale, ou une `const` initialisée avec une chaîne littérale, comme nom du hook.

### CONFORMANCE:HOOK_FOREIGN_NAMESPACE {#conformance-hook-foreign-namespace}

Cause. Un nom déclaré avec `defineHooks` ou dans une augmentation `GwenRuntimeHooks` de `@gwenjs/schema`, ou un nom passé à un appel d'émission, ne commence pas par `<hookNamespace>:`. `hookNamespace` est `gwen.hookNamespace` dans `package.json`. La vérification est ignorée quand cette valeur est absente ou invalide. Fix. Renommez le hook en `<hookNamespace>:<action>`.

### CONFORMANCE:HOOK_NAMESPACE_INVALID {#conformance-hook-namespace-invalid}

Cause. `gwen.hookNamespace` n'est pas une chaîne, ne respecte pas `^[a-z][a-z0-9-]*$`, est l'un des espaces de noms réservés du cœur (`engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, `service`), ou est un espace de noms du framework (`viewport`, `camera`, `physics`, `physics3d`). Il est aussi signalé quand il est absent et que le paquet déclare ou émet un hook. Les vérifications de format et de nom réservé donnent un constat sur la ligne 1 de `package.json`. Il est aussi signalé quand la valeur est égale au `gwen.hookNamespace` d'une base listée dans `gwen.extends` qui est installée et dont le `package.json` s'analyse : un constat par base dans ce cas, sur la même ligne, et le message nomme les deux. Une base qui ne peut pas être résolue ou analysée est laissée hors de cette comparaison. Fix. Réglez `gwen.hookNamespace` sur un nom en minuscules qui vous est propre, par exemple `"myplug"`, et ne réutilisez pas le hookNamespace d'une base.

### CONFORMANCE:HOOK_RESERVED {#conformance-hook-reserved}

Cause. Un appel d'émission (`emit`, `callHook`, `callHookParallel`, `callHookWith`) utilise un nom dont l'espace de noms est réservé par le cœur (`engine`, `entity`, `scene`, `plugin`, `actor`, `prefab`, `service`) ou appartient à un paquet du framework (`viewport`, `camera`, `physics`, `physics3d`). Fix. Écoutez ce hook avec `useHook`, et émettez un hook de votre propre espace de noms.

### CONFORMANCE:HOOK_UNDECLARED {#conformance-hook-undeclared}

Cause. Un appel d'émission utilise un nom de l'espace de noms du paquet qu'aucun fichier du paquet ne déclare, ni avec `defineHooks`, ni dans une augmentation `GwenRuntimeHooks` de `@gwenjs/schema`. La vérification est ignorée quand `gwen.hookNamespace` est absent ou invalide. Fix. Déclarez le hook avec `defineHooks`, ou ajoutez-le à une augmentation `GwenRuntimeHooks`.

### CONFORMANCE:IMPORT_DEEP {#conformance-import-deep}

Cause. Un import dépasse les points d'entrée publics : un spécificateur `@gwenjs/<paquet>/dist/…`, un segment `dist` ou `src` d'une base communautaire listée telle quelle dans `gwen.extends` (`<base>/dist/…`, `<base>/src/…`), un sous-chemin qui n'est pas un point d'entrée d'un paquet du framework (par exemple `@gwenjs/core/nope`), un spécificateur relatif qui sort de la racine du paquet, ou un chemin absolu ou une URL `file:`. Un constat par ligne d'import. Dans un fichier de test, un sous-chemin de `@gwenjs/plugin-conformance` autre que `/runtime` et `/vitest` est aussi signalé. Un segment `src` d'un paquet `@gwenjs/*` n'est pas ce code. Fix. Importez un point d'entrée public du paquet du framework, gardez les imports relatifs dans le paquet, et importez `<base>/extension` depuis une base listée.

### CONFORMANCE:IMPORT_FORBIDDEN_ENTRY {#conformance-import-forbidden-entry}

Cause. Import d'un point d'entrée du framework qu'un plugin ne peut pas utiliser ici : `@gwenjs/app`, `@gwenjs/vite`, `@gwenjs/physics2d`, `@gwenjs/physics3d` ou `@gwenjs/physics3d-fracture` (tout sous-chemin), ou un point d'entrée réservé aux tests (`@gwenjs/core/testing`, `@gwenjs/core/node`, `@gwenjs/renderer-core/testing`) importé depuis `src`. Un fichier de test peut importer les points d'entrée réservés aux tests : un fichier `*.test.*` ou `*.spec.*`, ou un fichier sous `tests/`, `test/` ou `__tests__/`, ou un fichier `*.setup.*` à la racine du paquet. Fix. Déplacez l'import dans un fichier de test, ou utilisez un point d'entrée d'exécution du framework.

### CONFORMANCE:IMPORT_FOREIGN_PLUGIN {#conformance-import-foreign-plugin}

Cause. Un import nomme un autre plugin : un paquet `@gwenjs/*` qui n'est pas un paquet du framework, ou un paquet de `node_modules` (cherché depuis la racine du paquet puis ses ancêtres) dont le `package.json` a `gwen.type` `"plugin"` ou liste `@gwenjs/core` dans `peerDependencies` ou `dependencies`. Un paquet non installé, ou dont le `package.json` est illisible, n'est pas un plugin. Dans un fichier de test, `@gwenjs/plugin-conformance`, `@gwenjs/plugin-conformance/runtime` et `@gwenjs/plugin-conformance/vitest` ne sont pas signalés. Un paquet communautaire (un nom hors de `@gwenjs/`) qui liste `<base>` tel quel dans `gwen.extends` ne signale pas `<base>/extension` sous ce code : les autres spécificateurs de cette base sont `EXTENSION_ENTRY`, `IMPORT_INTERNAL` ou `IMPORT_DEEP`. `<base>` est un nom de paquet, ni un paquet du framework ni un paquet interdit. Une entrée qui n'est pas un nom de paquet, par exemple `@gwenjs/camera2d/sub`, n'est pas une base : ce code s'applique encore quand le paquet installé est un plugin. Un paquet officiel garde ce code pour une base listée. Fix. Partagez l'état par un service ou un paquet du framework. Une extension communautaire n'importe que `<base>/extension`.

### CONFORMANCE:IMPORT_INTERNAL {#conformance-import-internal}

Cause. Un spécificateur `@gwenjs/<paquet>/internal`, ou avec un segment `wasm` (`@gwenjs/core/wasm/light`), dans `src`, dans un fichier de test, ou inclus dans `dist` (fichiers `.js`, `.mjs`, `.cjs`, `.d.ts`, `.d.mts` et `.d.cts`). Les mêmes segments d'une base communautaire listée telle quelle dans `gwen.extends` (`<base>/internal`, `<base>/wasm`) sont signalés de la même façon, y compris quand le fichier est dans `dist`. Les imports, `export … from`, `import("…")`, `require("…")`, `import x = require("…")` et les types `import("…")` sont lus (un import dynamique quoi qu'il suive son premier argument). Un constat par ligne d'import. Fix. Utilisez un point d'entrée public du paquet du framework, ou `<base>/extension` depuis une base listée.

### CONFORMANCE:IMPORT_NOT_PUBLIC {#conformance-import-not-public}

Cause. Un nom importé d'un point d'entrée du framework n'est pas dans l'API publique de ce point d'entrée : un import nommé, un ré-export (`export { x } from`), un import par défaut d'un point d'entrée sans export par défaut, ou une propriété lue sur un import d'espace de noms (`ns.name`, `ns["name"]`, `ns.Type`). Une propriété lue est ignorée là où une fonction, un bloc, un `for` ou un `catch` englobant redéfinit le nom de l'espace de noms. Les noms viennent de `FRAMEWORK_ENTRIES`, généré depuis les fichiers `public-api.snap.json` du framework (valeurs et types). Un constat par nom, sur la ligne du nom. Le même code est signalé pour un nom importé de `<base>/extension`, où `<base>` est un paquet communautaire listé tel quel dans `gwen.extends` et la base est installée avec un `package.json` qui s'analyse. Les noms publics sont les valeurs et les types exportés par le fichier de types de `exports["./extension"]` (`types`, puis `types.import`, puis `import`). Un import nommé réservé aux types est vérifié comme un import de valeur. Une base qui ne peut pas être résolue, ou dont le `package.json` ne peut pas être analysé, n'est pas signalée sous ce code. Un fichier sous `dist` n'est pas vérifié pour ces noms. Quand ce fichier de types n'est pas sur le disque, un constat sur la ligne du spécificateur dit que le spécificateur déclare ce chemin, qui n'est pas construit. Quand la cible `./extension` ne nomme aucun fichier de types et aucun fichier d'import, un constat sur la ligne du spécificateur le dit. Fix. Utilisez un nom que le point d'entrée public exporte.

### CONFORMANCE:IMPORT_UNDECLARED {#conformance-import-undeclared}

Cause. Un fichier importe un paquet du framework que `package.json` ne déclare pas : dans `src`, dans `peerDependencies` ; dans un fichier de test, dans `peerDependencies` ou `devDependencies`. Un paquet listé seulement dans `dependencies` n'est pas déclaré. Un constat par ligne d'import. Fix. Ajoutez le paquet à `peerDependencies`.

### CONFORMANCE:INVALID_SPEC {#conformance-invalid-spec}

Cause. `checkPluginPackage` a reçu un `profile` qui n'est ni `"plugin"` ni `"package"`, un `lockfileBase` mauvais ou vide, aucun `pnpm-lock.yaml` sur la référence ou à la racine du paquet, une `lockfileVersion` autre que 9.0, ou un git qui ne peut pas démarrer. Un `profile` invalide renvoie ce seul constat et n'exécute aucune vérification. Chaque cas de lockfile donne un constat de la vérification `lockfile`, et les autres vérifications s'exécutent. `runPluginConformance` renvoie aussi ce code et une liste `checks` vide quand la spec d'exécution est invalide ou que le paquet construit ne peut pas être chargé, et il ne lance pas d'exception. `factories` doit lister au moins une fabrique, et chaque `export` doit être une chaîne non vide. `packageName` doit être une chaîne non vide égale au `name` de `<root>/package.json`, où `root` vaut par défaut le répertoire de travail du processus. `frames`, s'il est donné, doit être un entier supérieur ou égal à 1. `variant`, s'il est donné, doit être `"light"`, `"physics2d"` ou `"physics3d"`. Le même code est renvoyé quand `<root>/package.json` est absent, illisible ou n'est pas du JSON valide ; quand `exports` n'est pas un objet ; quand `exports["."].import` (et `exports["./module"].import` quand ce sous-chemin est présent) n'est pas une chaîne `./` non vide qui se résout vers un fichier sous la racine du paquet ; quand cette cible est hors de la racine ou sous `src` ; ou quand un `export` de fabrique n'est pas exporté par le point d'entrée construit. Le message nomme `factories`, l'export, les deux noms de paquet, `frames` et le minimum 1, ou les trois variantes, selon le cas. Le chargeur lit seulement le point d'entrée construit et ne lit pas `<root>/src`. Fix. Passez `"plugin"` ou `"package"` comme `profile`. Pour le lockfile, passez une référence qui contient `pnpm-lock.yaml` à la racine du paquet, commitez le lockfile, et utilisez le lockfile v9. Pour une spec d'exécution, listez au moins une fabrique, réglez `packageName` sur le nom du paquet, et pointez `exports["."].import` vers le point d'entrée construit.

### CONFORMANCE:LOCKFILE_DRIFT {#conformance-lockfile-drift}

Cause. Quand `lockfileBase` est donné, un paquet tiers de `pnpm-lock.yaml` (un nom qui ne commence pas par `@gwenjs/`) a été ajouté, retiré, ou résolu vers un autre ensemble de versions que sur cette référence git. La version est le texte d'une clé `packages:` ou `snapshots:` après le nom et avant le premier `(`. Un constat par nom, sur la première clé du nouveau fichier ; un paquet retiré est signalé sur `<ref>:pnpm-lock.yaml`. Fix. Commitez le `pnpm-lock.yaml` mis à jour et relisez le changement tiers, ou épinglez le paquet. Une installation de pile ne doit déplacer que les paquets `@gwenjs`.

### CONFORMANCE:MANIFEST {#conformance-manifest}

Cause. Le profil `plugin` ne met pas `gwen.type` à `"plugin"`, `license` est vide ou absent, aucun fichier LICENSE n'est à la racine, ou `package.json` manque, est illisible, ou n'est pas du JSON valide. Un `gwen.extends` mal formé est le même code, pour les deux profils : la valeur n'est pas un tableau (ligne de la clé), une entrée n'est pas une chaîne (ligne de cette entrée), un nom de paquet est listé deux fois (ligne de l'entrée suivante), le paquet liste son propre nom (ligne de cette entrée), ou une entrée n'est pas un nom de paquet (ligne de cette entrée). Un nom de paquet est un `@scope/` facultatif plus un segment, sans `/` supplémentaire, sans espace et sans majuscule. Un champ absent et un tableau vide ne sont pas des constats. Un constat par problème. Fix. Réglez `gwen.type` et un `license` non vide, ajoutez `LICENSE`, `LICENSE.md` ou `LICENSE.txt`, et écrivez du JSON valide. Écrivez `gwen.extends` comme un tableau de noms de paquets, par exemple `["fixture-base"]`.

### CONFORMANCE:PEER_RANGE {#conformance-peer-range}

Cause. Un paquet du framework (une clé de `FRAMEWORK_RANGES`) est listé dans `dependencies` ou `optionalDependencies` (quel que soit le spécificateur), ou son spécificateur dans `peerDependencies` n'est pas exactement la plage de `FRAMEWORK_RANGES` (égalité stricte des chaînes, sans analyse semver). Le groupe lié utilise `CORE_RANGE`. `@gwenjs/math` peut rester dans `dependencies` ou `optionalDependencies` avec n'importe quel spécificateur ; son pair doit quand même être sa propre plage, pas `CORE_RANGE`. Une section qui n'est pas un objet est ignorée. Un spécificateur qui n'est pas une chaîne est affiché avec `JSON.stringify`. Un paquet hors de `FRAMEWORK_RANGES` est ignoré. Un constat par clé, sur la ligne de la clé dans `package.json`. La vérification s'exécute pour les deux profils, y compris quand `exports` a un constat. Fix. Déclarez le paquet dans `peerDependencies` sur sa plage `FRAMEWORK_RANGES`, et épinglez-le exactement dans `devDependencies`. Retirez-le de `dependencies`, sauf `@gwenjs/math`.

### CONFORMANCE:PEER_UNUSED {#conformance-peer-unused}

Cause. Un paquet du framework (une clé propre de `FRAMEWORK_RANGES`) ou une base listée dans `gwen.extends` est listé dans `peerDependencies` et aucun fichier script de `src` qui n'est pas un test ne l'utilise. Un usage est un spécificateur de module lu par le parcours des imports (`import`, `export … from`, `import type`, `export type … from`, `import("…")`, `require("…")`) ou un `declare module "<paquet>"` dont le nom est une chaîne. Un sous-chemin comme `@gwenjs/kit/plugin` compte pour `@gwenjs/kit`, et `<base>/extension` compte comme un usage de la base. Un `declare module` dans un script de `src` qui n'est pas un test, ou dans un fichier `.d.ts`, `.d.mts` ou `.d.cts` sous `src`, compte. Un import présent seulement dans un test ne compte pas. Un paquet qui n'est ni un paquet du framework ni une base listée n'est pas signalé. `src` n'est lu que lorsque le paquet déclare un tel pair. Un constat par pair, sur la ligne de la clé dans `package.json`. La vérification s'exécute pour les deux profils. Fix. Retirez le paquet de `peerDependencies`, ou importez-le depuis `src`.

### CONFORMANCE:PRIVATE_EXPORT {#conformance-private-export}

Cause. Une valeur exportée par un sous-chemin de `exports` (tout sous-chemin listé, public ou non) commence par `_`. Les noms qui commencent par `__` ne sont pas lus. Un constat par valeur, sur le fichier de types construit. Fix. Renommez la valeur sans le tiret bas, ou cessez de l'exporter.

### CONFORMANCE:PUBLINT {#conformance-publint}

Cause. `publint --strict` signale un message, et les avertissements comptent comme des erreurs. Le constat reprend le texte de publint et pointe la ligne du champ dans `package.json`. Il est aussi signalé quand publint ne peut pas empaqueter ou lire le paquet. La vérification ne s'exécute que si `exports` n'a aucun constat. Fix. Changez le champ comme le message l'indique.

### CONFORMANCE:README_EXPORT_MISSING {#conformance-readme-export-missing}

Cause. Un nom listé dans `public-api.snap.json` (une valeur ou un type, de n'importe quel sous-chemin) n'est pas écrit dans le `README.md` du paquet comme identifiant entier : `readyState` ne mentionne pas `ready`. Un constat par nom distinct, pour le premier sous-chemin qui le liste. Le nom `default` n'est jamais exigé. Un `README.md` absent donne un seul constat, `README.md is missing` ; un `README.md` qui existe mais ne peut pas être lu (par exemple un dossier) donne un seul constat, `README.md cannot be read (<code>)`. La vérification lit le snapshot après une écriture et ne s'exécute que si `exports` n'a aucun constat. Fix. Documentez le nom dans `README.md`, ou cessez de l'exporter.

### CONFORMANCE:RUNTIME_DEV_WARNING {#conformance-runtime-dev-warning}

Cause. Le journal du moteur a enregistré une entrée de niveau `warn` ou `error` pendant l'exécution (`packages/schema/src/logger-structured.ts:2`). Le message nomme cette entrée. `debug` et `info` ne sont pas signalés. Le moteur copie un événement du bus dans ce journal (`packages/core/src/engine/engine-error-policy.ts:408`) avec le même message et `payload.code` égal au code de l'événement. Cette copie n'est pas un second constat. Fix. Retirez l'appel `warn` ou `error`.

### CONFORMANCE:RUNTIME_FRAME_EVENT {#conformance-runtime-frame-event}

Cause. `engine.errors` a émis un événement de niveau `warning`, `error` ou `fatal` pendant les frames, et le code n'était pas `CORE:QUERY_PER_ENTITY_PATH`. Le message nomme le code de l'événement, le message de l'événement et la frame. La frame est l'index commençant à 1 de cet `engine:update` : la troisième frame est 3. `engine.frameCount` pendant le hook est encore le compte précédent, car `frameCompleted` s'exécute après le hook (`packages/core/src/engine/engine-loop.ts:385`, `packages/core/src/engine/engine-loop.ts:427`, `packages/core/src/engine/engine-stats.ts:73`). Fix. Cessez d'émettre cet événement, ou baissez son niveau sous `warning`.

### CONFORMANCE:RUNTIME_PER_ENTITY_PATH {#conformance-runtime-per-entity-path}

Cause. Une frame a émis `CORE:QUERY_PER_ENTITY_PATH` (`packages/core/src/engine/engine-errors.ts:341`). Le message nomme `context.api` et `context.phase`, par exemple `Query.each` et `engine:update` (`packages/core/src/engine/engine-internals.ts:142`). Ce code est réservé au mode dev : `warnPerEntityPath` ne fait rien quand `__GWEN_DEV__` est faux (`packages/core/src/engine/engine-internals.ts:131`). Seul un hook de système déclenche l'avertissement (`packages/core/src/context/scope.ts:191`, `packages/core/src/engine/engine-internals.ts:134`), donc `query.each()` depuis le hook `engine:update` du plugin lui-même n'est pas signalé. Un système que le paquet exporte comme une fabrique normale est couvert. Le même événement n'est pas aussi signalé comme `RUNTIME_FRAME_EVENT`. Fix. Parcourez la requête par chunk (`for (const chunk of query)`).

### CONFORMANCE:RUNTIME_REQUIRES {#conformance-runtime-requires}

Cause. L'installation ne correspond pas à `requires`. Sans `requires`, le plugin doit s'installer seul, et les plugins installés doivent être la ligne de base plus son nom. Avec `requires.plugins` ou `requires.services`, `engine.use` seul doit rejeter avec l'erreur de dépendance du moteur qui nomme chaque entrée non satisfaite, puis réussir après `frameworkProviders`, et les plugins installés doivent être ces fournisseurs plus son nom. Tout autre nom installé est une installation cachée, et le message liste les plugins installés. Un plugin qui installe son propre système depuis `setup` est signalé : `CameraCorePlugin` le fait avec `CameraSystem` (`packages/camera-core/src/camera-core-plugin.ts:70`, `packages/camera-core/src/camera-system.ts:35`), et ce système est lui-même un plugin (`packages/core/src/system/runtime/define-system.ts:266`). Un plugin officiel (`official`, ou un `packageName` qui commence par `@gwenjs/` quand `official` est absent) ne peut nommer dans `requires.plugins` qu'un plugin de ce paquet ou un nom de `FRAMEWORK_PLUGIN_NAMES`. Fix. Déclarez l'exigence ferme, passez les plugins du framework dans `frameworkProviders`, et exportez un système comme sa propre fabrique.

### CONFORMANCE:RUNTIME_SHAPE {#conformance-runtime-shape}

Cause. Le retour d'une fabrique a une clé propre qui n'est pas dans `GWEN_PLUGIN_KEYS` (lu depuis `@gwenjs/schema`). Le message nomme le paquet, l'export et la clé, par exemple `onUpdate`. Un constat par fabrique en cause. Fix. Retirez cette clé. Un hook de frame appartient à un système ou à un acteur, pas à l'objet plugin.

### CONFORMANCE:RUNTIME_PROVIDES {#conformance-runtime-provides}

Cause. `engine.use` a rejeté le plugin pour une règle de `provide` : `setup` n'a pas fourni une clé déclarée dans `provides`, ou `setup` a appelé `provide` avec une clé non déclarée. Le message contient le code d'erreur du moteur pour `provide`. Un constat. Un plugin qui fournit chaque clé déclarée passe, et un plugin sans `provides` aussi. Fix. Fournissez chaque clé déclarée dans `setup`, et déclarez chaque clé que vous fournissez.

### CONFORMANCE:RUNTIME_OPTIONS {#conformance-runtime-options}

Cause. Une fabrique fixe `invalidOptions`, et `engine.use` installe le plugin au lieu de le rejeter avec `CORE:PLUGIN_OPTIONS_INVALID`. La vérification ne s'exécute pas quand `invalidOptions` est absent. Fix. Rejetez ces options depuis `options.validate` de `definePlugin`, avant `setup`.

### CONFORMANCE:SNAPSHOT_MISMATCH {#conformance-snapshot-mismatch}

Cause. `public-api.snap.json` diffère des types construits de `exports` : une valeur, un type ou un sous-chemin est dans l'un et pas dans l'autre, ou le fichier manque, n'est pas du JSON valide, ou a une forme invalide. Le fichier liste, par sous-chemin, les `values` et `types` triés, au format gwen. Un sous-chemin dont le point d'entrée de module n'est pas construit (son fichier `types`, sinon son fichier `types.import`, sinon son fichier `import`) donne un constat. Un sous-chemin dont la cible ne nomme aucun de ces fichiers (par exemple `{ "default": "./dist/x.js" }`, une condition imbriquée ou un tableau) donne un constat aussi : `subpath "." declares no types or import file`. Une cible `null` bloque le sous-chemin et est ignorée. Une cible qui n'est pas un point d'entrée de module (un `.wasm`, un `.css`) ou un motif (`./x/*`) n'est jamais exigée. La vérification lit le paquet et ne modifie rien, sauf avec `--write` (CLI) ou `write: true` (`checkPluginPackage`, `checkSnapshot`) : le fichier est alors réécrit à partir du build avant la comparaison, au format gwen (JSON sur 2 espaces, saut de ligne final, noms triés), et il reste intact s'il contient déjà les mêmes noms. Les clés gardent l'ordre de l'ancien fichier, un nouveau sous-chemin suit dans l'ordre de `exports`, et un sous-chemin qui n'est plus dans `exports` est retiré ; sans ancien fichier, les clés suivent l'ordre de `exports`. Le fichier est remplacé via un fichier temporaire : une écriture qui échoue garde l'ancien ; elle donne un seul constat, `public-api.snap.json cannot be written (<code>)`. Un sous-chemin dont la cible n'est pas un point d'entrée de module garde son ancienne entrée. Rien n'est écrit, et les constats sont ceux d'une lecture, tant qu'un sous-chemin n'est pas construit ou ne déclare ni fichier `types` ni fichier `import`, tant que `exports` ne nomme aucun sous-chemin, ou tant que le snapshot existe et ne peut pas être lu. `PRIVATE_EXPORT` reste signalé après une écriture. Dans `checkPluginPackage`, elle ne s'exécute que si `exports` n'a aucun constat ; `checkSnapshot` n'exécute pas la vérification `exports`. Un fichier de snapshot qui existe mais ne peut pas être lu (par exemple un dossier) est signalé `cannot be read (<code>)`, pas comme manquant, avec ou sans `--write`. Fix. Construisez le paquet, puis lancez `gwen-conformance check --write` pour mettre à jour `public-api.snap.json`, ou changez l'export.

### CONFORMANCE:TEST_MOCKS_FRAMEWORK {#conformance-test-mocks-framework}

Cause. Un fichier de test appelle `mock` ou `doMock` de `vi` avec un paquet `@gwenjs/` autre que le paquet lui-même, ou `vitest.config.*` ou `vite.config.*` à la racine du paquet a une entrée `resolve.alias` ou `test.alias` dont la clé est un tel spécificateur (une chaîne, une chaîne calculée, ou une expression régulière qui commence par `@gwenjs/` ; les formes objet et tableau sont lues). Les fichiers de test sont les fichiers `*.test.*` et `*.spec.*`, les fichiers sous `tests`, `test` ou `__tests__`, et les fichiers `*.setup.*` à la racine du paquet. Fix. Utilisez le vrai paquet. Pour obtenir un moteur, démarrez-en un avec `createRealEngine` de `@gwenjs/core/testing`, et retirez l'alias.
