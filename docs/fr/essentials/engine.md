---
title: Le moteur
description: Configurer le moteur GWEN avec gwen.config.ts et y accéder à l'exécution.
---

# Le moteur

Le **moteur GWEN** est le runtime qui démarre votre jeu, charge le WASM, gère les scènes et exécute vos systèmes à chaque frame. La configuration se fait dans **`gwen.config.ts`** au moment du build — vous ne démarrez jamais le moteur manuellement.

::: info Auto-imports
`useEngine` est auto-importé dans un projet GWEN. L'import explicite n'est nécessaire que dans les tests ou sans le plugin Vite.
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
| `engine.loop` | `'internal' \| 'external'` | Propriété de la boucle de jeu (défaut `'internal'`) |
| `engine.maxDeltaSeconds` | `number` | Delta temps max par frame (défaut `0.1`) |
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
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const DebugSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    const stats = engine.getStats()
    console.log(`FPS: ${stats.fps}, entités: ${stats.entityCount}`)
  })
})
```

## Statistiques de frame

`engine.getStats()` retourne des métriques de performance en direct :

| Champ | Type | Description |
|---|---|---|
| `fps` | `number` | Images par seconde |
| `frameCount` | `number` | Total de frames depuis le démarrage |
| `entityCount` | `number` | Nombre d'entités actives |
| `deltaTime` | `number` | Delta de la dernière frame en secondes |

## Mettre en pause et reprendre

```ts
engine.pause()   // arrêter la boucle de frames
engine.resume()  // redémarrer la boucle de frames
```

En mode boucle externe (`engine.loop: 'external'`), avancez les frames manuellement :

```ts
engine.advance(delta)  // exécuter une frame avec le delta donné (en secondes)
```

## Résumé de l'API

| | |
|---|---|
| `defineConfig(options)` | Configuration du framework au moment du build |
| `useEngine()` | Accéder au moteur brut (tout contexte moteur) |
| `engine.getStats()` | Métriques de performance en direct |
| `engine.pause()` | Mettre la boucle de frames en pause |
| `engine.resume()` | Reprendre la boucle de frames |
| `engine.advance(delta)` | Avance manuelle d'une frame (mode boucle externe) |

## Étapes suivantes

- **[Composants](/fr/essentials/components)** — Définissez les structures de données de votre jeu.
- **[Systèmes](/fr/essentials/systems)** — Écrivez des systèmes pour déplacer et mettre à jour les entités.
- **[Scènes](/fr/essentials/scenes)** — Organisez votre jeu en états distincts.
- **[Acteurs](/fr/essentials/actors)** — Créez des objets de jeu composables basés sur des instances.
