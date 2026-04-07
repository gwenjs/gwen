---
title: Démarrage rapide
description: Obtenez un projet GWEN exécuté en moins de cinq minutes.
---

# Démarrage rapide

Le moyen le plus rapide de démarrer un projet GWEN est d'utiliser le scaffold. En quelques secondes, vous aurez un modèle de jeu fonctionnel avec tous les outils configurés.

## Prérequis

- **Node.js 18+** et **pnpm 8+**
- Aucun Rust requis—WASM est livré précompilé dans les packages npm

::: tip
Si vous n'avez pas pnpm, installez-le globalement : `npm install -g pnpm`
:::

## Créer un projet

```sh
pnpm create @gwenjs/create my-game
cd my-game
pnpm install:all
pnpm dev
```

Votre navigateur devrait s'ouvrir sur `http://localhost:5173` avec votre premier jeu en cours d'exécution.

## Disposition du projet

Le scaffold crée un projet de jeu structuré :

```
my-game/
├── gwen.config.ts           # Config de compilation (modules, options moteur)
└── src/
    ├── components/          # Définitions defineComponent()
    │   └── Position.ts
    ├── systems/             # Implémentations defineSystem()
    │   └── Movement.ts
    ├── scenes/              # Définitions defineScene()
    │   └── GameScene.ts
    ├── actors/              # defineActor() — entités basées sur les instances
    │   └── Player.ts
    ├── prefabs/             # definePrefab() — modèles réutilisables
    │   └── Bullet.ts
    └── router.ts            # defineSceneRouter() — FSM de navigation des scènes
```

## Configuration de compilation — `gwen.config.ts`

Définissez les modules et les options du moteur à la compilation :

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
  },
})
```

## Votre premier composant

Un composant est une donnée. Définissons un composant `Position` :

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('Position', () => ({
  x: 0,
  y: 0,
}))
```

## Votre premier système

Les systèmes itèrent sur les entités et les mettent à jour à chaque frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { Position } from '../components/Position'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position] })

  onUpdate(() => {
    // Chaque frame, déplacez chaque entité avec une Position
    query.each(({ c }) => {
      const pos = c[Position]
      pos.x += 0.5  // Déplacer à droite
      pos.y += 0.1  // Déplacer légèrement vers le bas
    })
  })
})
```

## Votre première scène

**src/scenes/GameScene.ts**
```typescript
import { defineScene } from '@gwenjs/core/scene'
import { MovementSystem } from '../systems/Movement'

export const GameScene = defineScene({
  name: 'Game',
  systems: [MovementSystem],
})
```

## Routeur de scènes

Définissez la navigation entre les scènes :

**src/router.ts**
```typescript
import { defineSceneRouter } from '@gwenjs/core/scene'
import { GameScene } from './scenes/GameScene'

export const AppRouter = defineSceneRouter({
  initial: 'game',
  routes: {
    game: { scene: GameScene, on: {} },
  },
})
```

## Exécutez-le

```sh
pnpm dev
```

Ouvrez votre navigateur. Vous devriez voir votre jeu s'exécuter—le système de mouvement met à jour les positions à chaque frame, et vous voyez le résultat rendu.

## Étapes suivantes

- **[Installation](/fr/guide/installation)** — Ajoutez GWEN à un projet existant.
- **[Structure du projet](/fr/guide/project-structure)** — Comprendre l'anatomie d'un projet GWEN.
- **[Le moteur](/fr/essentials/engine)** — Apprenez la configuration et le démarrage du moteur.
- **[Composants](/fr/essentials/components)** — Concevez des schémas de composants.
- **[Systèmes](/fr/essentials/systems)** — Maîtrisez les requêtes et crochets de cycle de vie des systèmes.
