---
title: Structure du projet
description: Vue d'ensemble d'une disposition typique de projet GWEN.
---

# Structure du projet

Comprendre comment un projet GWEN est organisé vous aide à écrire du code qui se met à l'échelle et reste maintenable. Voici une structure typique et ce que chaque répertoire fait.

## Disposition typique

```
my-game/
├── src/
│   ├── main.ts                    # Point d'entrée du moteur
│   ├── components/                # Définitions de composants
│   │   ├── Position.ts
│   │   ├── Velocity.ts
│   │   ├── Health.ts
│   │   └── index.ts               # Réexporter tous les composants
│   ├── systems/                   # Implémentations de systèmes
│   │   ├── Movement.ts
│   │   ├── Collision.ts
│   │   ├── Rendering.ts
│   │   └── index.ts               # Réexporter tous les systèmes
│   ├── scenes/                    # Définitions de scènes
│   │   ├── MainMenu.ts
│   │   ├── GameScene.ts
│   │   ├── GameOver.ts
│   │   └── index.ts
│   ├── prefabs/                   # Usines d'entités
│   │   ├── Player.ts
│   │   ├── Enemy.ts
│   │   ├── Projectile.ts
│   │   └── index.ts
│   ├── plugins/                   # Usines de plugins personnalisés
│   │   ├── PhysicsPlugin.ts
│   │   ├── InputPlugin.ts
│   │   └── index.ts
│   ├── assets/                    # Ressources statiques
│   │   ├── sprites/
│   │   ├── sounds/
│   │   └── levels/
│   └── utils/                     # Aides et utilitaires
│       ├── math.ts
│       └── input.ts
├── vite.config.ts                 # Configuration Vite + @gwenjs/vite
├── gwen.config.ts                 # Configuration du moteur GWEN (optionnel)
├── tsconfig.json                  # Paramètres TypeScript
├── package.json
└── pnpm-lock.yaml
```

## Objectifs des répertoires

### `src/main.ts` — Point d'entrée du moteur

Initialise le moteur GWEN, connecte tous les modules, systèmes et scènes :

```typescript
import { createEngine, defineConfig } from '@gwenjs/app'
import * as components from './components'
import * as systems from './systems'
import * as scenes from './scenes'

const engine = createEngine(
  defineConfig({
    modules: Object.values(components),
    systems: Object.values(systems),
    scenes: Object.values(scenes),
    initialScene: 'game',
  })
)

engine.run()
```

### `src/components/` — Définitions de composants

Chaque fichier définit un ou plusieurs schémas de composants. Les composants sont des conteneurs de données attachés aux entités.

**src/components/Position.ts**
```typescript
import { defineComponent } from '@gwenjs/core'

export const Position = defineComponent('position', () => ({
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

Les systèmes sont la couche logique. Ils demandent des entités et modifient leurs composants à chaque frame.

**src/systems/Movement.ts**
```typescript
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { Position, Velocity } from '../components'

export const MovementSystem = defineSystem(() => {
  const query = useQuery({ with: [Position, Velocity] })

  onUpdate(() => {
    query.each(({ c }) => {
      const pos = c[Position]
      const vel = c[Velocity]
      pos.x += vel.vx
      pos.y += vel.vy
    })
  })
})
```

### `src/scenes/` — Définitions de scènes

Les scènes sont des fonctions qui créent des entités et configurent le gameplay. Pensez-y comme des « niveaux » ou « écrans ».

**src/scenes/GameScene.ts**
```typescript
import { defineScene, createEntity } from '@gwenjs/core'
import { Player } from '../prefabs'
import { EnemyPrefab } from '../prefabs'

export const GameScene = defineScene('game', ({ entities }) => {
  // Générer le joueur
  entities.add(Player.create())

  // Générer des ennemis
  for (let i = 0; i < 5; i++) {
    entities.add(EnemyPrefab.create({ x: i * 50, y: 10 }))
  }
})
```

### `src/prefabs/` — Usines d'entités

Les prefabs sont des modèles réutilisables pour générer des entités identiques. Ils encapsulent les composants initiaux d'une entité et ses données.

**src/prefabs/Player.ts**
```typescript
import { createEntity } from '@gwenjs/core'
import { Position, Velocity, Health } from '../components'

export const PlayerPrefab = {
  create: () => {
    const entity = createEntity()
    entity.add(Position, { x: 100, y: 100 })
    entity.add(Velocity, { vx: 0, vy: 0 })
    entity.add(Health, { hp: 100 })
    return entity
  },
}
```

### `src/plugins/` — Plugins personnalisés

Les plugins étendent GWEN avec de nouveaux systèmes, composants ou crochets de cycle de vie. Utilisez-les pour des fonctionnalités réutilisables comme la gestion des entrées, l'audio ou l'analyse.

**src/plugins/InputPlugin.ts**
```typescript
import { definePlugin } from '@gwenjs/kit'
import { InputSystem } from '../systems/Input'

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  systems: [InputSystem],
  install: (engine) => {
    console.log('Input plugin installed')
  },
}))
```

### `src/assets/` — Fichiers statiques

Gardez les sprites, sons, données de niveaux et autres ressources organisés ici. Vite gérera le bundling et l'optimisation.

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

Les aides communes qui ne s'ajustent pas ailleurs : fonctions mathématiques, aides d'entrée, gestionnaires d'état, etc.

**src/utils/math.ts**
```typescript
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
```

## Fichiers de configuration

### `vite.config.ts` — Configuration de compilation

Configure Vite et le plugin Vite GWEN :

```typescript
import { defineConfig } from 'vite'
import { gwenVite } from '@gwenjs/vite'

export default defineConfig({
  plugins: [gwenVite()],
})
```

### `gwen.config.ts` — Configuration du moteur (optionnel)

Paramètres GWEN avancés comme la sélection de la variante WASM, le mode debug ou les chargeurs de modules personnalisés :

```typescript
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  wasmVariant: 'release', // ou 'debug'
  enableDebugMode: true,
})
```

### `tsconfig.json` — Configuration TypeScript

Assure la vérification stricte des types et la résolution correcte des modules :

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  }
}
```

## Modèles de mise à l'échelle

Lorsque votre jeu grandit, envisagez ces modèles organisationnels :

**Par fonctionnalité** — Regroupez les composants, systèmes et scènes connexes :

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

**Par responsabilité** — Gardez les systèmes, composants et prefabs dans leurs propres répertoires au niveau supérieur (voir ci-dessus). Cela fonctionne bien pour les petits jeux.

**Par domaine** — Séparez le gameplay, les graphiques, la physique, l'audio et la mise en réseau dans leurs propres domaines avec des plugins.

## Bonnes pratiques

1. **Utilisez les fichiers index** — Réexportez depuis `components/index.ts`, `systems/index.ts`, etc., pour des imports propres.
2. **Un composant par fichier** — Plus facile à trouver et refactoriser.
3. **Nommez les systèmes d'après ce qu'ils font** — `MovementSystem`, `CollisionSystem`, pas `UpdateLogic`.
4. **Prefabs pour les entités complexes** — Si une entité utilise 3+ composants, créez un prefab pour cela.
5. **Plugins pour les fonctionnalités réutilisables** — Gestion d'entrée, interface utilisateur, animations—enveloppez dans des plugins pour que d'autres projets puissent les réutiliser.

## Étapes suivantes

- **[Composants](/fr/essentials/components)** — Apprenez à concevoir des schémas de composants.
- **[Systèmes](/fr/essentials/systems)** — Maîtrisez les requêtes et crochets des systèmes.
- **[Scènes](/fr/essentials/scenes)** — Composez et gérez les scènes.
- **[Prefabs](/fr/essentials/prefabs)** — Créez des modèles d'entités réutilisables.
