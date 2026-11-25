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
| `dts` | `boolean` | `true` | Émet les fichiers `.d.ts` (auto-imports, modules wasm). |
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

## `@gwenjs/vite/scanners` {#vite-scanners}

`@gwenjs/vite/scanners` lit les fichiers du projet et renvoie des faits à leur sujet (`packages/vite/package.json:22`). Il n'importe pas Vite : une app ou un CLI peut l'appeler sans pair Vite. Le pipeline réécrit un module à la fois ; voir [Pipeline de build](/fr/advanced/build-pipeline).

```ts
import {
  scanScenes,
  scanDefineHooks,
  scanLayoutNames,
  scanEasingNames,
  scanWasmModuleNames,
} from '@gwenjs/vite/scanners'

const root = '/path/to/project'
const scenes = scanScenes(root)
const hooks = scanDefineHooks(root)
const layouts = scanLayoutNames(root, ['src/layouts/**/*.ts'])
const easings = scanEasingNames(root)
const wasmModules = scanWasmModuleNames(root, ['src'])
```

| Fonction | Lit | Renvoie |
|---|---|---|
| `scanScenes(projectRoot, options?)` | `src/scenes/*.ts` (`packages/vite/src/scanners/index.ts:139`) | `SceneInfo[]` |
| `scanDefineHooks(root, options?)` | `src/hooks.ts`, puis `src/hooks/*.ts` par ordre de nom (`packages/vite/src/scanners/index.ts:288`) | `HookExport[]` : `{ file, name }` par liaison |
| `scanLayoutNames(root, include, options?)` | les fichiers sous le dossier de base de chaque glob `include`, le texte avant son premier `**` (`packages/vite/src/scanners/index.ts:320`) | `LayoutName[]` : `{ file, name }` par liaison `defineLayout`, triés par fichier |
| `scanEasingNames(root, options?)` | `src/**` (`packages/vite/src/scanners/index.ts:356`) | `string[]`, trié et sans doublon |
| `scanWasmModuleNames(root, dirs)` | chaque fichier `.ts`, `.tsx`, `.js` et `.jsx` sous chaque dossier de `dirs` (`packages/vite/src/scanners/index.ts:532`) | `WasmModuleScan` : `{ hits, skipped }` |

`resolveMainScene(scenes, fromConfig?)` renvoie le `mainScene` donné quand il a été découvert (`packages/vite/src/scanners/index.ts:222`), et la première scène quand `mainScene` est omis (`packages/vite/src/scanners/index.ts:224`).

- **Hooks.** Une liaison compte quand c'est `export const X = defineHooks(...)`, ou un `const X = defineHooks(...)` de premier niveau nommé dans `export { X }`. Un export par défaut n'est pas typé. `options.file` et `options.dir` remplacent les chemins par défaut, relatifs à `root`.
- **Easings.** Un nom compte quand c'est le littéral de `easing:` dans un argument objet d'un appel `useTween`. Un littéral gabarit ou un identifiant n'est pas lu.
- **Noms de modules wasm.** Un appel compte quand c'est `<objet>.loadWasmModule<T>({ name: '<littéral>' })`, ou un appel nu d'un `loadWasmModule` lié par un motif de déstructuration. Ce scanner reconnaît le nom de la méthode, pas une liaison d'import. Une fonction locale de même nom, une méthode aliasée, `.call`, `.apply`, `Reflect.apply` et une propriété calculée ne sont pas vus. `T` doit être un type importé par son nom. Un appel dont le nom n'est pas un littéral, sans argument de type, ou dont le type n'est pas importable (déclaré dans le même fichier, générique, en ligne ou d'espace de noms) va dans `skipped`, avec la raison `non-literal name`, `no type argument` ou `type not importable`. Un dossier `node_modules` n'est jamais parcouru. Chaque hit est `{ name, typeImport: { from, name }, file, line }` ; `from` est le specifier tel qu'écrit et `name` le nom d'export d'origine. [Noms typés](/fr/kit/custom-plugin#typed-names) montre ce que le plugin Vite en écrit.
- **Analyse stricte.** Chaque scanner analyse avec `parseModule`. Un fichier avec une erreur de syntaxe lève `VITE:TRANSFORM_PARSE_FAILED` et nomme `<fichier>:<ligne>:<colonne>`. Un fichier illisible lève le même code, avec l'erreur Node en `cause` (`packages/vite/src/scanners/read.ts:39`). Aucun fichier n'est ignoré.
- **`autoImports`.** Les appelés se reconnaissent par les liaisons d'import, jamais par le texte. Passez `options.autoImports` (type `ScanOptions`) pour reconnaître un `defineScene(...)` sans import qui repose sur un auto-import. Sans elle, seul un import explicite depuis un paquet GWEN est reconnu. Un alias et un import d'espace de noms sont reconnus. Une fonction locale de même nom, ou une fonction d'un autre paquet, ne l'est pas.
- **Pas de barrels.** Un scanner ne suit pas un ré-export (`packages/vite/src/scanners/read.ts:50`). Un fichier scanné doit importer la fonction GWEN depuis son paquet, ou compter sur `autoImports`.

## `ViteErrorCodes`

Exporté par `@gwenjs/vite`.

| Clé | Code |
|---|---|
| `SCENE_NAME_UNRESOLVED` | `VITE:SCENE_NAME_UNRESOLVED` |
| `SCENE_NAME_DUPLICATE` | `VITE:SCENE_NAME_DUPLICATE` |
| `MAIN_SCENE_UNKNOWN` | `VITE:MAIN_SCENE_UNKNOWN` |
| `WASM_MODULE_DUPLICATE` | `VITE:WASM_MODULE_DUPLICATE` |

`scanScenes` lève `VITE:SCENE_NAME_UNRESOLVED` et `VITE:SCENE_NAME_DUPLICATE`. `resolveMainScene` lève `VITE:MAIN_SCENE_UNKNOWN`. Ces trois indices sont présents quand `process.env["NODE_ENV"]` n'est pas `"production"` (`packages/vite/src/scanners/index.ts:162`, `packages/vite/src/scanners/index.ts:177`, `packages/vite/src/scanners/index.ts:216`).

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
