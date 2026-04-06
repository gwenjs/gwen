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
├── src/
│   ├── main.ts              # Point d'entrée : configuration du moteur
│   ├── components/          # Définitions defineComponent()
│   │   └── Position.ts
│   ├── systems/             # Implémentations defineSystem()
│   │   └── Movement.ts
│   ├── actors/              # defineActor() — entités nommées, singletons
│   │   └── Player.ts
│   ├── scenes/              # Définitions defineScene()
│   │   └── GameScene.ts
│   └── prefabs/             # Modèles d'entités réutilisables (definePrefab)
│       └── Bullet.ts
├── gwen.config.ts           # Config moteur (plugins, scènes, variante WASM)
├── tsconfig.json
└── package.json
```

## Votre premier composant

Un composant est une donnée que les entités peuvent avoir. Définissons un composant `Position` :

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('position', () => ({
  x: 0,
  y: 0,
}))
```

C'est tout. `defineComponent` retourne un schéma qui définit quelles données voyagent avec ce composant. GWEN stockera les données de position efficacement dans la mémoire linéaire WASM.

## Votre premier système

Les systèmes sont où la magie opère. Ils itèrent sur les entités ayant des composants spécifiques et les mettent à jour à chaque frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position } from '../components/Position'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position] })

  onUpdate(() => {
    // Chaque frame, déplacez chaque entité avec un composant Position
    query.each(({ entity, c }) => {
      const pos = c[Position]
      pos.x += 0.5  // Déplacer à droite
      pos.y += 0.1  // Déplacer légèrement vers le bas
    })
  })
})
```

Le hook `useQuery` trouve toutes les entités ayant le composant `Position`. `onUpdate` s'exécute à chaque frame. À l'intérieur, nous itérons avec `.each()` et mettons à jour les positions. WASM prend soin d'écrire les modifications.

## Votre première scène

Les scènes sont des endroits où vous placez et composez des entités. Ce sont des fonctions qui configurent un niveau jouable.

**src/scenes/GameScene.ts**
```typescript
import { defineScene, createEntity } from '@gwenjs/core'
import { Position } from '../components/Position'

export const GameScene = defineScene('game', ({ entities }) => {
  // Créer un acteur (une entité avec des composants rendus)
  const player = createEntity()
  entities.add(player)
  
  // Lui donner une Position
  entities.setComponent(player, Position, { x: 100, y: 100 })
})
```

## Connecter tout ensemble

**src/main.ts**
```typescript
import { createEngine, defineConfig } from '@gwenjs/app'
import { Position } from './components/Position'
import { MovementSystem } from './systems/Movement'
import { GameScene } from './scenes/GameScene'

const engine = createEngine(
  defineConfig({
    modules: [Position],
    systems: [MovementSystem],
    scenes: [GameScene],
    initialScene: 'game',
  })
)

engine.run()
```

## Exécutez-le

```sh
pnpm dev
```

Ouvrez votre navigateur. Vous devriez voir votre jeu s'exécuter—les entités sont créées, le système de mouvement met à jour leurs positions à chaque frame, et vous voyez le résultat rendu.

## Étapes suivantes

- **[Installation](/fr/guide/installation)** — Ajoutez GWEN à un projet existant.
- **[Structure du projet](/fr/guide/project-structure)** — Comprendre l'anatomie d'un projet GWEN.
- **[Composants](/fr/essentials/components)** — Apprenez à concevoir vos schémas de composants.
- **[Systèmes](/fr/essentials/systems)** — Maîtrisez les requêtes et crochets de cycle de vie des systèmes.
- **[Scènes](/fr/essentials/scenes)** — Composez des niveaux et du gameplay complexes.
