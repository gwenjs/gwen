---
title: "@gwenjs/vite"
description: "Référence API pour @gwenjs/vite — plugins Vite pour les projets GWEN."
---

# @gwenjs/vite

`pnpm add -D @gwenjs/vite`

Intégration Vite pour GWEN. Fournit le plugin composite principal, un optimiseur ECS opt-in, et des plugins de build pour la physique 2D/3D.

---

## `gwenVitePlugin(options?)`

Le point d'entrée principal. Un plugin Vite composite qui configure le bundling WASM, le hot-reload des acteurs et scènes, les auto-imports, les déclarations TypeScript, le support des layouts, les helpers tween, et l'optimiseur ECS optionnel — le tout en une seule registration.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin({
      wasm: { variant: 'auto', hmr: true },
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
| `wasm.variant` | `'debug' \| 'release' \| 'auto'` | `'auto'` | Variante du build WASM à charger. `'auto'` choisit `release` en production et `debug` en développement. |
| `wasm.wasmPath` | `string` | — | Surcharge le chemin résolu du fichier WASM. |
| `wasm.hmr` | `boolean` | `true` | Active le hot-module replacement WASM en développement. |
| `autoImports` | `AutoImport[]` | `[]` | Entrées d'auto-import supplémentaires injectées dans le module virtuel. |
| `typeTemplates` | `GwenTypeTemplate[]` | `[]` | Entrées de template `.d.ts` supplémentaires. |
| `gwenDir` | `string` | `'.gwen'` | Répertoire où les fichiers générés (dts, modules virtuels) sont écrits. |
| `dts` | `boolean` | `true` | Émet un fichier de déclaration de types `gwen.d.ts`. |
| `actors.dir` | `string` | `'src/actors'` | Répertoire racine analysé pour les fichiers d'acteurs. |
| `actors.hmr` | `boolean` | `true` | Active le HMR pour les modules d'acteurs. |
| `layout.include` | `string[]` | — | Patterns glob des fichiers de layout à inclure. |
| `layout.disableNameInjection` | `boolean` | `false` | Désactive l'injection du nom dans chaque définition de layout. |
| `sceneRouter` | `GwenSceneRouterOptions` | — | Options transmises au transform du scene-router. |
| `tween` | `GwenTweenOptions` | — | Options transmises au transform tween. |
| `optimizer` | `boolean \| GwenOptimizerInlineOptions` | — | Active l'optimiseur ECS en masse (voir ci-dessous). |

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

## `physics2dVitePlugin(options?)`

Plugin Vite de build pour le support de la physique 2D. Il effectue l'**inlining des layers** : les références aux layers nommés comme `Layers.wall` sont remplacées par leur valeur numérique (ex. `4`) au moment du build à l'aide de `MagicString`, en préservant des source maps précises.

:::tip Enregistrement automatique
Lorsque vous utilisez le module `@gwenjs/physics2d` dans `gwen.config.ts`, ce plugin est enregistré automatiquement. Vous n'avez pas besoin de l'ajouter manuellement dans la plupart des cas.
:::

Si un layer est défini via `defineLayers()` mais n'est jamais référencé dans la source transformée, le plugin émet un **avertissement de build** Vite afin que les définitions de layers mortes ne passent pas inaperçues.

### Config du module (sous-clé `vite`)

Les options de ce plugin peuvent être transmises via la configuration du module dans `gwen.config.ts` :

```ts
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics2d', {
      gravity: -9.81,
      vite: {
        debug: true,  // transmis à physics2dVitePlugin
      },
    }],
  ],
})
```

### Utilisation manuelle

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin, physics2dVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin(),
    physics2dVitePlugin({ debug: false }),
  ],
})
```

### Options

| Option | Type | Défaut | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Journalise chaque substitution de layer dans la console. |

---

## `physics3dVitePlugin(options?)`

Plugin Vite de build pour le support de la physique 3D. Fournit deux fonctionnalités :

1. **Inlining des layers** — identique à `physics2dVitePlugin`, remplace les références de layers nommés par leurs valeurs numériques au moment du build.
2. **Pré-baking BVH** — lorsque `bvhPrebake: true`, détecte les patterns d'appel `useMeshCollider('./file.glb')` et pré-compile la structure d'accélération BVH au moment du build. L'argument chaîne est remplacé par `{ __bvhUrl: 'bvh-<hash>.bin' }`, de sorte que le calcul BVH coûteux est effectué une seule fois lors du build plutôt qu'à l'exécution.

:::tip Enregistrement automatique
Lorsque vous utilisez le module `@gwenjs/physics3d` dans `gwen.config.ts`, ce plugin est enregistré automatiquement. Vous n'avez pas besoin de l'ajouter manuellement dans la plupart des cas.
:::

### Config du module (sous-clé `vite`)

```ts
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics3d', {
      gravity: { y: -9.81 },
      vite: {
        bvhPrebake: true,
        debug: false,  // transmis à physics3dVitePlugin
      },
    }],
  ],
})
```

### Utilisation manuelle

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin, physics3dVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin(),
    physics3dVitePlugin({ bvhPrebake: true, debug: false }),
  ],
})
```

### Options

| Option | Type | Défaut | Description |
|---|---|---|---|
| `debug` | `boolean` | `false` | Journalise chaque substitution de layer et chaque opération de pré-baking BVH. |
| `bvhPrebake` | `boolean` | `false` | Pré-compile les structures BVH pour les mesh colliders au moment du build. |

:::warning Déprécié
`createGwenPhysics3DPlugin()` est déprécié. Remplacez toutes les utilisations par `physics3dVitePlugin()`.
:::

---

## Définitions de types

### `GwenViteOptions`

```ts
interface GwenViteOptions {
  wasm?: {
    variant?: 'debug' | 'release' | 'auto'
    wasmPath?: string
    hmr?: boolean
  }
  autoImports?: AutoImport[]
  typeTemplates?: GwenTypeTemplate[]
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
