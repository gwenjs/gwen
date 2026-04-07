---
title: Structure du projet
description: Vue d'ensemble d'une disposition typique de projet GWEN.
---

# Structure du projet

Comprendre comment un projet GWEN est organisé vous aide à écrire du code qui se met à l'échelle et reste maintenable. Voici une structure typique et ce que chaque répertoire fait.

## Disposition typique

```
my-game/
├── gwen.config.ts           # Configuration du framework et du moteur
└── src/
    ├── components/          # defineComponent() — définitions de données ECS
    │   └── Position.ts
    ├── systems/             # defineSystem() — logique de jeu
    │   └── Movement.ts
    ├── scenes/              # defineScene() — définitions de scènes
    │   └── GameScene.ts
    ├── actors/              # defineActor() — objets de jeu basés sur les instances
    │   └── Player.ts
    ├── prefabs/             # definePrefab() — modèles d'entités
    │   └── Bullet.ts
    ├── router.ts            # defineSceneRouter() — FSM de navigation des scènes
    ├── plugins/             # definePlugin() — plugins personnalisés (optionnel)
    ├── assets/              # images, audio, polices...
    └── utils/               # utilitaires partagés
```

::: info Fichiers auto-générés
`index.html` et `main.ts` sont générés automatiquement par le framework GWEN. Vous n'avez jamais besoin de les créer ou de les modifier.
:::

## Objectifs des répertoires

### `gwen.config.ts` — Configuration

Déclare les modules et les options du moteur à la compilation :

```typescript
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
  },
})
```

### `src/components/` — Définitions de composants

Chaque fichier définit un ou plusieurs schémas de composants. Les composants sont des conteneurs de données attachés aux entités.

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('Position', () => ({
  x: 0,
  y: 0,
}))
```

Utilisez `src/components/index.ts` pour réexporter tout :

```typescript
export * from './Position'
export * from './Velocity'
export * from './Health'
```

### `src/systems/` — Implémentations de systèmes

Les systèmes sont la couche logique. Ils interrogent les entités et modifient leurs composants à chaque frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { Position, Velocity } from '../components'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position, Velocity] })

  onUpdate((dt) => {
    for (const id of query) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

### `src/scenes/` — Définitions de scènes

Les scènes sont des fonctions qui configurent le gameplay et enregistrent les systèmes :

**src/scenes/GameScene.ts**
```typescript
import { defineScene } from '@gwenjs/core/scene'
import { MovementSystem, CollisionSystem, RenderSystem } from '../systems'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, CollisionSystem, RenderSystem],
})
```

### `src/actors/` — Entités nommées

Les acteurs sont des entités nommées, de type singleton, définies avec `defineActor()`. Utilisez-les pour les éléments qui existent une seule fois par scène — le joueur, un boss, une caméra. Chaque acteur a son propre cycle de vie (`onStart`, `onDestroy`) et peut utiliser des composables physiques.

**src/actors/Player.ts**
```typescript
import { defineActor, onStart, onDestroy } from '@gwenjs/core/actor'
import { useDynamicBody, useBoxCollider } from '@gwenjs/physics2d'
import { Position, Health } from '../components'

export const PlayerActor = defineActor('Player', () => {
  useDynamicBody({ gravityScale: 1 })
  useBoxCollider({ width: 1, height: 2 })

  onStart(() => {
    Position.x[0] = 100
    Position.y[0] = 100
  })
})
```

### `src/prefabs/` — Modèles d'entités réutilisables

Les préfabriqués sont définis avec `definePrefab()` pour les entités que vous générez en masse — balles, pièces, ennemis. Ils déclarent quels composants chaque instance obtient et leurs valeurs par défaut.

**src/prefabs/Bullet.ts**
```typescript
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, DamageTag } from '../components'

export const BulletPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { x: 0, y: 10 } },
  { def: DamageTag, defaults: {} },
])
```

### `src/plugins/` — Plugins personnalisés

Les plugins étendent GWEN avec de nouveaux systèmes, composants ou crochets de cycle de vie. Utilisez-les pour des fonctionnalités réutilisables comme la gestion des entrées, l'audio ou l'analytique.

**src/plugins/InputPlugin.ts**
```typescript
import { definePlugin } from '@gwenjs/kit/plugin'
import { InputSystem } from '../systems/Input'

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  systems: [InputSystem],
  install: (engine) => {
    console.log('Plugin d\'entrée installé')
  },
}))
```

### `src/assets/` — Fichiers statiques

Gardez les sprites, sons, données de niveau et autres ressources organisés ici. Vite s'occupera du bundling et de l'optimisation.

```
assets/
├── sprites/
│   ├── player.png
│   ├── enemies/
│   └── ui/
├── sounds/
│   ├── jump.wav
│   └── music/
└── levels/
    ├── level1.json
    └── level2.json
```

### `src/utils/` — Utilitaires partagés

Utilitaires communs sans catégorie propre : fonctions mathématiques, aides d'entrée, gestionnaires d'état, etc.

**src/utils/math.ts**
```typescript
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
```

## Modèles de mise à l'échelle

À mesure que votre jeu grandit, considérez ces modèles organisationnels :

**Par fonctionnalité** — Groupez les composants, systèmes et scènes connexes ensemble :

```
src/
├── features/
│   ├── player/
│   │   ├── components/
│   │   ├── systems/
│   │   └── prefabs/
│   ├── enemies/
│   │   ├── components/
│   │   ├── systems/
│   │   └── prefabs/
│   └── ui/
│       ├── systems/
│       └── scenes/
```

**Par responsabilité** — Gardez les systèmes, composants et préfabriqués dans leurs propres répertoires de haut niveau (illustrés ci-dessus). Cela fonctionne bien pour les petits jeux.

**Par domaine** — Séparez le gameplay, les graphiques, la physique, l'audio et la mise en réseau dans leurs propres domaines avec des plugins.

## Bonnes pratiques

1. **Utilisez les fichiers d'index** — Réexportez depuis `components/index.ts`, `systems/index.ts`, etc., pour des imports propres.
2. **Un composant par fichier** — Plus facile à trouver et à refactoriser.
3. **Nommez les systèmes d'après ce qu'ils font** — `MovementSystem`, `CollisionSystem`, pas `UpdateLogic`.
4. **Préfabriqués pour les entités complexes** — Si une entité utilise 3+ composants, créez un préfabriqué pour cela.
5. **Plugins pour les fonctionnalités réutilisables** — Gestion des entrées, UI, animations—emballez dans des plugins pour que d'autres projets puissent les réutiliser.

## Prochaines étapes

- **[Composants](/fr/essentials/components)** — Apprenez à concevoir des schémas de composants.
- **[Systèmes](/fr/essentials/systems)** — Maîtrisez les requêtes et crochets de système.
- **[Scènes](/fr/essentials/scenes)** — Composez et gérez les scènes.
- **[Préfabriqués](/fr/essentials/prefabs)** — Créez des modèles d'entités réutilisables.
