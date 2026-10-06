---
title: Le moteur
description: Configurer le moteur GWEN avec gwen.config.ts et y accéder à l'exécution.
---

# Le moteur

Le **moteur GWEN** est le runtime qui démarre votre jeu, charge le WASM, gère les scènes et exécute vos systèmes à chaque frame. La configuration se fait dans **`gwen.config.ts`** au moment du build — vous ne démarrez jamais le moteur manuellement.

::: info Import explicite requis
`useEngine` n'est pas auto-importé. Importez-le explicitement quand vous avez besoin d'accéder directement au moteur :
```ts
import { useEngine } from '@gwenjs/core'
```
:::

## Configuration de build

Utilisez `defineConfig()` depuis `@gwenjs/app` pour déclarer les modules et les options du moteur :

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    targetFPS: 60,
  },
})
```

Ce fichier est traité au moment du build par le plugin Vite.

## Référence de configuration

| Propriété | Type | Description |
|---|---|---|
| `modules` | `string[]` | Modules à activer (ex. `['@gwenjs/physics2d']`) |
| `engine.maxEntities` | `number` | Nombre max d'entités simultanées (défaut `10_000`) |
| `engine.targetFPS` | `number` | FPS cible (défaut `60`) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | Variante WASM à charger |
| `engine.loop` | `'internal' \| 'external'` | Mode de boucle de jeu (défaut `'internal'`) |
| `engine.maxDeltaSeconds` | `number` | Delta temps max par frame (défaut `0.1`) |
| `engine.physicsHz` | `number` | Fréquence de simulation fixe en Hz. `0` = delta variable (défaut) |
| `engine.maxCatchupSteps` | `number` | Nombre max de pas fixes par frame réelle (défaut `2`) |
| `engine.debug` | `boolean` | Activer le mode debug global |
| `vite` | `object` | Extension statique de la config Vite |
| `hooks` | `Partial<GwenBuildHooks>` | Abonnements aux hooks de build |
| `plugins` | `GwenPlugin[]` | Inscription directe de plugins (escape hatch) |

## Étendre Vite

GWEN gère votre configuration Vite — pas besoin de `vite.config.ts`. Utilisez le champ `vite` pour une config statique :

```ts
export default defineConfig({
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
  },
})
```

Pour une config conditionnelle ou programmatique, utilisez le hook de build :

```ts
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = { '~assets': './src/assets' }
    },
  },
})
```

## Accéder au moteur à l'exécution

Dans une factory de système ou d'acteur, appelez `useEngine()` pour obtenir l'instance brute du moteur. C'est rarement nécessaire — les composables comme `useQuery`, `useService` et `useHook` couvrent la plupart des cas d'usage.

```ts
import { useEngine } from '@gwenjs/core'

export const DebugSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    const stats = engine.getStats()
    console.log(`FPS: ${stats.fps}, frame : ${stats.frameCount}`)
  })
})
```

## Statistiques de frame

`engine.getStats()` retourne des métriques de performance en direct :

| Champ | Type | Description |
|---|---|---|
| `fps` | `number` | Images par seconde |
| `frameCount` | `number` | Total de frames depuis le démarrage |
| `deltaTime` | `number` | Delta de la dernière frame en secondes |
| `overBudget` | `boolean` | Présent seulement si `__GWEN_DEV__` et `debug` sont vrais. `true` si cette frame a dépassé le budget FPS |

En mode boucle externe (`engine.loop: 'external'`), avancez les frames manuellement avec `engine.advance(delta)` :

```ts
engine.advance(delta)  // exécuter une frame avec le delta donné (en secondes)
```

## Modes de boucle

GWEN supporte trois configurations de boucle, définies via `engine.loop` et `engine.physicsHz` dans `gwen.config.ts`.

### Boucle interne (défaut)

Le framework appelle `requestAnimationFrame` en interne. `onUpdate` reçoit un `dt` variable à chaque frame.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'internal', targetFPS: 60 },
})
```

### Boucle externe

Utilisez `loop: 'external'` quand vous contrôlez la boucle vous-même — par exemple dans un rendu personnalisé, un harnais de test, ou une simulation côté serveur.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'external' },
})
```

Le framework appelle `engine.startExternal()` au lieu de `engine.start()`. Avancez les frames manuellement :

```ts
// votre boucle
function tick(dt: number) {
  engine.advance(dt) // secondes
  requestAnimationFrame(() => tick(getDelta()))
}
```

### Pas fixe

Définissez `physicsHz` à une valeur non nulle pour activer une boucle à pas fixe. `onUpdate` reçoit toujours `1 / physicsHz` comme `dt`, quelle que soit la cadence réelle.

```ts
export default defineConfig({
  engine: {
    physicsHz: 60,      // 60 pas fixes par seconde
    maxCatchupSteps: 2, // au plus 2 pas par frame réelle
  },
})
```

Le pattern accumulateur :
1. À chaque frame réelle, le temps écoulé s'accumule.
2. Pour chaque `1 / physicsHz` secondes accumulées, un pas de simulation est déclenché.
3. Si la machine prend du retard, `maxCatchupSteps` évite une spirale de rattrapage.

`engine.timeScale` s'applique toujours : un `timeScale` de `0.5` divise par deux la vitesse de simulation effective.

::: info Déterminisme
Avec `physicsHz > 0`, chaque pas de simulation s'exécute avec le même `dt`. Deux exécutions atteignent le même état du monde lorsque chaque pas fixe reçoit les mêmes entrées dans le même ordre, en partant de la même configuration, sur la même version de GWEN, la même variante WASM et le même navigateur ou runtime. Pour contrôler les pas exactement, pilotez la boucle vous-même avec `engine.advance(1 / physicsHz)`. GWEN 1.0 ne garantit pas le déterminisme entre navigateurs, systèmes d'exploitation ou processeurs, et n'en donne aucune pour la boucle à delta variable (`physicsHz: 0`). Lire `performance.now()`, `Date.now()` ou `Math.random()` dans un système casse la reproductibilité. GWEN 1.0 n'a pas de snapshot du monde ni de sauvegarde/restauration intégrés.
:::

## Résumé de l'API

| | |
|---|---|
| `defineConfig(options)` | Configuration du framework au moment du build |
| `useEngine()` | Accéder au moteur brut (tout contexte moteur) |
| `engine.getStats()` | Métriques de performance en direct |
| `engine.advance(delta)` | Avance manuelle d'une frame (mode boucle externe uniquement) |

## Étapes suivantes

- **[Composants](/fr/essentials/components)** — Définissez les structures de données de votre jeu.
- **[Systèmes](/fr/essentials/systems)** — Écrivez des systèmes pour déplacer et mettre à jour les entités.
- **[Scènes](/fr/essentials/scenes)** — Organisez votre jeu en états distincts.
- **[Acteurs](/fr/essentials/actors)** — Créez des objets de jeu composables basés sur des instances.
