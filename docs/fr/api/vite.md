---
title: "@gwenjs/vite"
description: "Référence API pour @gwenjs/vite — plugins Vite pour les projets GWEN."
---

# @gwenjs/vite

`pnpm add -D @gwenjs/vite`

Intégration Vite pour GWEN. Fournit le plugin composite principal, un optimiseur ECS opt-in, et des plugins de build pour la physique 2D/3D.

---

## `gwenVitePlugin(options?)`

Le point d'entrée principal. Un plugin Vite composite qui configure le hot-reload des acteurs et scènes, les auto-imports, les déclarations TypeScript, le support des layouts, les helpers tween, et l'optimiseur ECS optionnel — le tout en une seule registration.

Les noms sont injectés par `gwen:transform-pipeline` dans `gwen()` comme dans `gwenVitePlugin()`, selon la liaison d'import.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin({
      dts: true,
      actors: { dir: 'src/actors', hmr: true },
      optimizer: {
        componentsDir: 'src',
        tier: 'core',
        debug: false,
      },
    }),
  ],
})
```

### Options

| Option | Type | Défaut | Description |
|---|---|---|---|
| `autoImports` | `AutoImport[]` | `[]` | Entrées d'auto-import supplémentaires injectées dans le module virtuel. |
| `gwenDir` | `string` | `'.gwen'` | Répertoire où les fichiers générés (dts, modules virtuels) sont écrits. |
| `dts` | `boolean` | `true` | Émet un fichier de déclaration de types `gwen.d.ts`. |
| `actors.dir` | `string` | `'src/actors'` | Répertoire racine analysé pour les fichiers d'acteurs. |
| `actors.hmr` | `boolean` | `true` | Active le HMR pour les modules d'acteurs. |
| `layout.include` | `string[]` | — | Patterns glob des fichiers de layout à inclure. |
| `layout.disableNameInjection` | `boolean` | `false` | Désactive l'injection du nom dans chaque définition de layout. |
| `sceneRouter` | `GwenSceneRouterOptions` | — | Options transmises au transform du scene-router. |
| `tween` | `GwenTweenOptions` | — | Options transmises au transform tween. |
| `optimizer` | `boolean \| GwenOptimizerUserOptions` | — | Active l'optimiseur ECS en masse (voir ci-dessous). |

### L'option `optimizer`

La clé `optimizer` contrôle si le transform de l'optimiseur ECS s'exécute dans `gwenVitePlugin`.

- **Omis ou `false`** — mode détection uniquement. L'optimiseur analyse votre source et journalise les patterns qui pourraient être optimisés, mais n'apporte aucune modification au code. Utile pour auditer.
- **`true`** — mode transform avec les valeurs par défaut : `componentsDir: 'src'`, `tier: 'core'`, `debug: false`.
- **Objet** — mode transform avec une configuration explicite.

```ts
// Détection uniquement (par défaut)
gwenVitePlugin()

// Transform avec les valeurs par défaut
gwenVitePlugin({ optimizer: true })

// Transform avec configuration explicite
gwenVitePlugin({
  optimizer: {
    componentsDir: 'src/ecs',
    tier: 'physics2d',
    debug: true,
  },
})
```

| Sous-option | Type | Défaut | Description |
|---|---|---|---|
| `componentsDir` | `string` | `'src'` | Répertoire analysé pour les appels `defineComponent`. |
| `tier` | `'core' \| 'physics2d' \| 'physics3d'` | `'core'` | Niveau d'optimisation. Utiliser un niveau physics si vos composants incluent des données physiques. |
| `debug` | `boolean` | `false` | Émet des journaux détaillés lors du pass d'optimisation. |

---

## `gwenOptimizerPlugin(options?)`

Plugin Vite standalone opt-in qui réécrit les boucles ECS critiques en opérations de tableau en masse. Utile quand vous souhaitez un contrôle fin sur la configuration de l'optimiseur indépendamment du plugin composite.

### Modes

- **`'detect'`** — analyse la source à la recherche de boucles `for...of` optimisables sur les résultats de requêtes et les journalise. Aucun code n'est modifié. Idéal pour un premier audit.
- **`'transform'`** — réécrit les patterns détectés en lectures/écritures de tableaux en batch, ce qui peut apporter des gains de débit significatifs pour de grandes populations d'entités.

### Utilisation standalone

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin, gwenOptimizerPlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin(),
    gwenOptimizerPlugin({
      mode: 'transform',
      tier: 'physics2d',
      componentsDir: 'src',
      debug: true,
    }),
  ],
})
```

### Utilisation intégrée

Passez directement la clé `optimizer` à `gwenVitePlugin` — inutile d'ajouter `gwenOptimizerPlugin` séparément :

```ts
gwenVitePlugin({ optimizer: { tier: 'physics2d', debug: true } })
```

:::tip
Préférez la forme intégrée pour la plupart des projets. Utilisez le plugin standalone uniquement lorsque vous devez positionner l'optimiseur à un endroit précis dans le pipeline de plugins Vite.
:::

### Options (`GwenOptimizerOptions`)

| Option | Type | Défaut | Description |
|---|---|---|---|
| `mode` | `'detect' \| 'transform'` | `'transform'` | Mode de l'optimiseur. |
| `tier` | `'core' \| 'physics2d' \| 'physics3d'` | `'core'` | Niveau d'optimisation correspondant aux types de composants utilisés. |
| `componentsDir` | `string` | `'src'` | Répertoire analysé pour les définitions de composants. |
| `debug` | `boolean` | `false` | Émet des journaux détaillés lors du pass de transform. |

---

## `physics2dVitePlugin()`

Plugin Vite de build pour la physique 2D. L'inlining des layers est l'unité `gwen:layer-inline`, enregistrée sur `gwen:transform-pipeline` depuis le `configResolved` de ce plugin. Une référence comme `Layers.wall` devient sa valeur numérique. La source map vient de la transformation du pipeline.

:::tip Enregistrement automatique
Lorsque vous utilisez le module `@gwenjs/physics2d` dans `gwen.config.ts`, ce plugin est enregistré automatiquement. Vous n'avez pas besoin de l'ajouter manuellement dans la plupart des cas.
:::

`Physics2DConfig` n'a pas de clé `vite`. Le module appelle `physics2dVitePlugin()` sans option.

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: {
    gravity: { y: -9.81 },
  },
})
```

### Utilisation manuelle

`gwen()` doit être dans la config Vite, pour que `gwen:transform-pipeline` y figure. Sinon, le plugin lève `PHYSICS2D:VITE_PIPELINE_MISSING`.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwen } from '@gwenjs/vite'
import { physics2dVitePlugin } from '@gwenjs/physics2d/module'

export default defineConfig({
  plugins: [gwen(), physics2dVitePlugin()],
})
```

---

## `physics3dVitePlugin(options?)`

Plugin Vite de build pour le support de la physique 3D. Fournit deux fonctionnalités :

1. **Inlining des layers** — l'unité `gwen:layer-inline`, enregistrée sur `gwen:transform-pipeline`. Les références de layers nommés deviennent leurs valeurs numériques. L'usage manuel exige que `gwen()` soit dans la config Vite.
2. **Pré-baking BVH** — lorsque `bvhPrebake: true`, détecte les patterns d'appel `useMeshCollider('./file.glb')` et pré-compile la structure d'accélération BVH au moment du build. L'argument chaîne est remplacé par `{ __bvhUrl: 'bvh-<hash>.bin' }`, de sorte que le calcul BVH coûteux est effectué une seule fois lors du build plutôt qu'à l'exécution.

:::tip Enregistrement automatique
Lorsque vous utilisez le module `@gwenjs/physics3d` dans `gwen.config.ts`, ce plugin est enregistré automatiquement. Vous n'avez pas besoin de l'ajouter manuellement dans la plupart des cas.
:::

### Config du module (sous-clé `vite`)

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics3d'],
  physics3d: {
    gravity: { x: 0, y: -9.81, z: 0 },
    vite: {
      bvhPrebake: true,
    },
  },
})
```

### Utilisation manuelle

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwen } from '@gwenjs/vite'
import { physics3dVitePlugin } from '@gwenjs/physics3d/module'

export default defineConfig({
  plugins: [gwen(), physics3dVitePlugin({ bvhPrebake: true })],
})
```

`gwen()` doit être dans la config Vite. Sans `gwen:transform-pipeline`, le plugin lève `PHYSICS3D:VITE_PIPELINE_MISSING`.

### Options

| Option | Type | Défaut | Description |
|---|---|---|---|
| `bvhPrebake` | `boolean` | `false` | Pré-compile les structures BVH pour les mesh colliders au moment du build. |

---

## `@gwenjs/vite/scanners`

`scanScenes` et `resolveMainScene` sont exportés par `@gwenjs/vite/scanners` (`packages/vite/package.json:22`). `scanScenes` lit `src/scenes/*.ts` et renvoie un `SceneInfo` par fichier (`packages/vite/src/scanners/index.ts:118`). `resolveMainScene` renvoie le `mainScene` donné quand il a été découvert (`packages/vite/src/scanners/index.ts:202`), et la première scène quand `mainScene` est omis (`packages/vite/src/scanners/index.ts:204`).

## `ViteErrorCodes`

Exporté par `@gwenjs/vite`.

| Clé | Code |
|---|---|
| `OPTIMIZER_UNKNOWN_COMPONENT` | `VITE:OPTIMIZER_UNKNOWN_COMPONENT` |
| `OPTIMIZER_UNKNOWN_FIELD` | `VITE:OPTIMIZER_UNKNOWN_FIELD` |
| `SCENE_NAME_UNRESOLVED` | `VITE:SCENE_NAME_UNRESOLVED` |
| `SCENE_NAME_DUPLICATE` | `VITE:SCENE_NAME_DUPLICATE` |
| `MAIN_SCENE_UNKNOWN` | `VITE:MAIN_SCENE_UNKNOWN` |

Le générateur de code lève `VITE:OPTIMIZER_UNKNOWN_COMPONENT` pour un composant absent du manifeste, et `VITE:OPTIMIZER_UNKNOWN_FIELD` pour un champ que le manifeste ne liste pas. Ces levées sont des `GwenError`, sans étiquette `[gwen:optimizer]`. L'indice est présent quand `NODE_ENV` n'est pas `production`. `scanScenes` lève `VITE:SCENE_NAME_UNRESOLVED` et `VITE:SCENE_NAME_DUPLICATE`. `resolveMainScene` lève `VITE:MAIN_SCENE_UNKNOWN`. Ces trois indices sont présents quand `process.env["NODE_ENV"]` n'est pas `"production"` (`packages/vite/src/scanners/index.ts:142`, `packages/vite/src/scanners/index.ts:157`, `packages/vite/src/scanners/index.ts:196`).

## Définitions de types

### `GwenViteOptions`

```ts
interface GwenViteOptions {
  autoImports?: AutoImport[]
  gwenDir?: string
  dts?: boolean
  actors?: {
    dir?: string
    hmr?: boolean
  }
  layout?: {
    include?: string[]
    disableNameInjection?: boolean
  }
  sceneRouter?: GwenSceneRouterOptions
  tween?: GwenTweenOptions
  optimizer?: boolean | {
    componentsDir?: string
    tier?: 'core' | 'physics2d' | 'physics3d'
    debug?: boolean
  }
}
```

### `GwenOptimizerOptions`

```ts
interface GwenOptimizerOptions {
  debug?: boolean
  mode?: 'detect' | 'transform'
  tier?: 'core' | 'physics2d' | 'physics3d'
  componentsDir?: string
}
```
