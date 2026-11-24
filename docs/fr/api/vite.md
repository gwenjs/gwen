---
title: "@gwenjs/vite"
description: "Référence API pour @gwenjs/vite — plugins Vite pour les projets GWEN."
---

# @gwenjs/vite

`pnpm add -D @gwenjs/vite`

Intégration Vite pour GWEN. Fournit le plugin composite principal et des plugins de build pour la physique 2D/3D.

---

## `gwenVitePlugin(options?)`

Le point d'entrée principal. Un plugin Vite composite qui configure le hot-reload des acteurs et scènes, les auto-imports, les déclarations TypeScript, le support des layouts et les helpers tween — le tout en une seule registration.

Les noms sont injectés par `gwen:transform-pipeline` dans `gwen()` comme dans `gwenVitePlugin()`, selon la liaison d'import. Les noms de layout et de scene-router sont un énoncé gardé par `__GWEN_DEV__`, donc les bundles de production n'en portent aucun.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwenVitePlugin({
      dts: true,
      actors: { dir: 'src/actors', hmr: true },
      optimizer: { debug: false },
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
| `layout.disableNameInjection` | `boolean` | `false` | Quand la valeur est vraie, l'unité `gwen:layout-name` n'est pas enregistrée. |
| `sceneRouter` | `GwenSceneRouterOptions` | — | Quand `disableNameInjection` est vrai, l'unité `gwen:scene-router-name` n'est pas enregistrée. |
| `tween` | `GwenTweenOptions` | — | Options transmises au transform tween. |
| `optimizer` | `boolean \| GwenOptimizerUserOptions` | — | Réservée. Acceptée et ignorée jusqu'à la réécriture du chemin chaud de #69. |

### L'option `optimizer`

Réservée. Acceptée et ignorée jusqu'à la réécriture du chemin chaud de #69. Elle accepte `boolean` ou `{ debug?: boolean }` et reste un no-op aujourd'hui. `gwen()` accepte la même option (`GwenPluginOptions.optimizer`), également ignorée.

```ts
gwenVitePlugin()

gwenVitePlugin({ optimizer: true })

gwenVitePlugin({ optimizer: { debug: true } })
```

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
2. **Pré-baking BVH** — lorsque `bvhPrebake: true`, l'unité `gwen:bvh-prebake` réécrit `useMeshCollider` quand son premier argument est une chaîne `.glb` relative (`./` ou `../`). Les arguments deviennent `{ __bvhUrl: "bvh-<hash>.bin" }`. Un build émet ce nom de fichier. En dev, les mêmes octets sont servis en mémoire sur `GET <base><name>`. Un fichier absent ou un calcul en échec lève `VITE:BVH_PREBAKE_FAILED`. `useConvexCollider` n'est pas réécrit. Les autres clés du second argument sont abandonnées.

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
| `bvhPrebake` | `boolean` | `false` | Réécrit un chemin `.glb` relatif de `useMeshCollider`. En dev, l'asset calculé est servi depuis la mémoire. |

---

## `@gwenjs/vite/scanners`

`scanScenes` et `resolveMainScene` sont exportés par `@gwenjs/vite/scanners` (`packages/vite/package.json:22`). `scanScenes` lit `src/scenes/*.ts` et renvoie un `SceneInfo` par fichier (`packages/vite/src/scanners/index.ts:118`). `resolveMainScene` renvoie le `mainScene` donné quand il a été découvert (`packages/vite/src/scanners/index.ts:202`), et la première scène quand `mainScene` est omis (`packages/vite/src/scanners/index.ts:204`).

## `ViteErrorCodes`

Exporté par `@gwenjs/vite`.

| Clé | Code |
|---|---|
| `SCENE_NAME_UNRESOLVED` | `VITE:SCENE_NAME_UNRESOLVED` |
| `SCENE_NAME_DUPLICATE` | `VITE:SCENE_NAME_DUPLICATE` |
| `MAIN_SCENE_UNKNOWN` | `VITE:MAIN_SCENE_UNKNOWN` |

`scanScenes` lève `VITE:SCENE_NAME_UNRESOLVED` et `VITE:SCENE_NAME_DUPLICATE`. `resolveMainScene` lève `VITE:MAIN_SCENE_UNKNOWN`. Ces trois indices sont présents quand `process.env["NODE_ENV"]` n'est pas `"production"` (`packages/vite/src/scanners/index.ts:142`, `packages/vite/src/scanners/index.ts:157`, `packages/vite/src/scanners/index.ts:196`).

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
  optimizer?: boolean | { debug?: boolean }
}
```
