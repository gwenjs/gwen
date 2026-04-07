---
title: Systèmes
description: Les systèmes contiennent toute la logique de jeu dans GWEN. Apprenez à les définir et les composer.
---

# Systèmes

Un **système** est une fonction qui s'exécute chaque frame et lit/écrit les données de composants. Les systèmes sont la couche logique de jeu de l'ECS de GWEN. Ce guide vous montre comment définir les systèmes, interroger les entités et accéder aux services.

## Les bases

### Définir un système

Utilisez `defineSystem()` pour déclarer un système. À l'intérieur de la fonction de configuration, enregistrez les callbacks qui s'exécutent pendant la boucle de jeu :

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  // Phase de configuration : s'exécute une fois quand le système s'initialise
  const entities = useQuery([Position, Velocity])

  // Callback de frame : s'exécute chaque frame
  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

Les systèmes sont enregistrés dans une scène :

```ts
import { defineScene } from '@gwenjs/core/scene'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, DamageSystem, RenderSystem],
})
```

### Pourquoi diviser les phases de configuration et frame ?

La phase de configuration est coûteuse (les requêtes sont calculées une fois), mais la phase frame est légère (juste de l'accès à la mémoire). Cette conception en deux phases signifie :

- **Configuration** — `useQuery()` scanne toutes les entités une fois, construisant l'ensemble correspondant
- **Frame** — `onUpdate()` itère sur le résultat de requête en cache (très rapide)

Si les requêtes étaient recalculées chaque frame, votre jeu serait lent.

## Crochets de cycle de vie

Les systèmes ont plusieurs crochets de callback disponibles :

| Crochet | Signature | Quand | Cas d'usage |
|---|---|---|---|
| `onUpdate()` | `onUpdate(cb: (dt: number) => void)` | Chaque frame | Mettre à jour les positions, vérifier les collisions |
| `onBeforeUpdate()` | `onBeforeUpdate(cb: (dt: number) => void)` | Avant la mise à jour principale | Pré-traiter les données |
| `onAfterUpdate()` | `onAfterUpdate(cb: (dt: number) => void)` | Après la mise à jour principale | Post-traiter les données |
| `onRender()` | `onRender(cb: () => void)` | Pendant la phase de rendu | Mises à jour de rendu |

Exemple :

```ts
import { defineSystem, useQuery, onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from '@gwenjs/core/system'
import { Position, Velocity } from './components'

export const MySystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onBeforeUpdate((dt) => {
    // Étape de pré-traitement
  })

  onUpdate((dt) => {
    // Mettre à jour l'état du jeu
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
    }
  })

  onAfterUpdate((dt) => {
    // Étape de post-traitement
  })

  onRender(() => {
    // Rendre l'état mis à jour
  })
})
```

## Requêtes

### Requête de base

Interroger toutes les entités avec un ensemble de composants :

```ts
const entities = useQuery([Position, Velocity])

onUpdate((dt) => {
  for (const id of entities) {
    // Traiter toutes les entités avec Position et Velocity
  }
})
```

### Exclure des composants

Exclure les entités qui ont un certain composant (souvent une étiquette) :

```ts
const alive = useQuery([Health], { exclude: [DeadTag] })

onUpdate(() => {
  for (const id of alive) {
    // Traiter seulement les entités vivantes
  }
})
```

### Requêtes réactives

Les requêtes sont réactives. Si une entité gagne ou perd un composant, le résultat de la requête se met à jour automatiquement :

```ts
const entities = useQuery([Health, Armor])

onUpdate(() => {
  // Si une entité perd son Armor, elle ne sera pas dans 'entities' au frame suivant
  for (const id of entities) {
    // ...
  }
})
```

## Accéder aux services

Les plugins exposent des services auxquels vous pouvez accéder depuis les systèmes en utilisant les crochets `use*` :

### Service physique

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { usePhysics2D } from '@gwenjs/core'

export const PhysicsSystem = defineSystem(() => {
  const physics = usePhysics2D()

  onUpdate(() => {
    const bodies = physics.queryAABB({ x: 0, y: 0, w: 100, h: 100 })
    // Gérer les requêtes physiques
  })
})
```

### Accès au moteur

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyDown('ArrowRight')) {
      // Gérer l'entrée
    }
  })
})
```

### useService

Utilisez `useService(key)` pour accéder à un service enregistré par un plugin via `engine.provide()`. Le type de retour est inféré depuis l'interface `GwenProvides`, augmentée par les plugins qui enregistrent des services.

```typescript
import { defineSystem, useService, onUpdate } from '@gwenjs/core/system'

export const AudioSystem = defineSystem(() => {
  const audio = useService('audio') // typé via l'augmentation GwenProvides

  onUpdate(() => {
    if (audio.isLoaded('bgm')) audio.play('bgm')
  })
})
```

## Accéder aux modules WASM

Utilisez `useWasmModule(name)` pour accéder à un module WASM chargé par un plugin via `engine.loadWasmModule()`. Le paramètre de type générique type l'objet `.exports`. Le module doit avoir été chargé par un plugin avant que ce système s'exécute.

```typescript
import { defineSystem, useWasmModule, onUpdate } from '@gwenjs/core/system'

export const PhysicsStepSystem = defineSystem(() => {
  const mod = useWasmModule<{ step: (dt: number) => void }>('my-physics')

  onUpdate((dt) => {
    mod.exports.step(dt)
  })
})
```

## En pratique

### Système d'IA pour les ennemis

Voici un exemple complet : les ennemis qui se rapprochent du joueur :

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'
import { Position, Velocity, EnemyTag, PlayerTag } from './components'

const ENEMY_SPEED = 50 // pixels par seconde

export const EnemyAISystem = defineSystem(() => {
  const enemies = useQuery([Position, Velocity, EnemyTag])
  const player = useQuery([Position, PlayerTag])

  onUpdate((dt) => {
    if (player.length === 0) return

    const playerPos = {
      x: Position.x[player[0]],
      y: Position.y[player[0]],
    }

    for (const id of enemies) {
      const dx = playerPos.x - Position.x[id]
      const dy = playerPos.y - Position.y[id]
      const dist = Math.sqrt(dx * dx + dy * dy)

      if (dist > 0) {
        Velocity.x[id] = (dx / dist) * ENEMY_SPEED
        Velocity.y[id] = (dy / dist) * ENEMY_SPEED
      }
    }
  })
})
```

### Système de dégâts

```ts
import {
  defineSystem,
  useQuery,
  onUpdate,
} from '@gwenjs/core/system'
import {
  removeComponent,
  addComponent,
} from '@gwenjs/core'
import {
  Health,
  DamageTag,
  DeadTag,
  Armor,
} from './components'

export const DamageSystem = defineSystem(() => {
  const damaged = useQuery([Health, DamageTag])

  onUpdate(() => {
    for (const id of damaged) {
      const armorValue = Armor.value[id] ?? 0
      const damageReduction = armorValue / (armorValue + 10)
      Health.current[id] -= 10 * (1 - damageReduction)

      if (Health.current[id] <= 0) {
        removeComponent(id, Health)
        addComponent(id, DeadTag)
      }

      removeComponent(id, DamageTag)
    }
  })
})
```

## Ordre des systèmes

Les systèmes s'exécutent dans l'ordre dans lequel vous les listez dans la scène. Si `RenderSystem` dépend de `PhysicsSystem`, ajoutez la physique en premier :

```ts
export const GameScene = defineScene({
  name: 'game',
  systems: [
    PhysicsSystem,      // S'exécute en premier
    MovementSystem,     // S'exécute en deuxième
    CollisionSystem,    // S'exécute en troisième
    RenderSystem,       // S'exécute en dernier (lit les positions mises à jour)
  ],
})
```

## Gestion des erreurs dans les systèmes

Les erreurs dans le callback `onUpdate` d'un système sont capturées et enregistrées. Le jeu continue :

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const SafeSystem = defineSystem(() => {
  onUpdate(() => {
    try {
      // Opération risquée
    } catch (err) {
      console.error('Erreur système :', err)
      // Le jeu continue
    }
  })
})
```

Pour les erreurs irrécupérables, émettez un événement :

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

export const EngineAwareSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (somethingBad) {
      engine.errors.emit({
        level: 'error',
        code: 'GAME:UNRECOVERABLE',
        message: 'Quelque chose s\'est mal passé',
      })
    }
  })
})
```

## Approfondissement

### Performance : Configuration vs. Frame

Quand vous appelez `useQuery([Position, Velocity])` dans la phase de configuration, GWEN :

1. Scanne toutes les entités
2. Construit une liste d'IDs correspondant à `[Position, Velocity]`
3. Met en cache le résultat

Quand la requête change (une entité gagne/perd un composant), le résultat est recalculé. Mais pendant la boucle de frame, l'itération est **O(n)** où n est la taille de la requête, pas le nombre total d'entités.

**Sans cache (lent) :**
```
for chaque entité dans le monde {
  if elle a Position et Velocity {
    // traiter
  }
}
// O(total des entités) par frame
```

**Avec cache (rapide) :**
```
entities = [id1, id2, id3, ...] // calculé une fois
for chaque entité dans entities {
  // traiter
}
// O(entités correspondantes) par frame
```

### Composition des systèmes

Un comportement complexe émerge de systèmes simples. Voici un exemple complet :

```ts
// Les systèmes mettent à jour les composants indépendamment
- MovementSystem met à jour Position en fonction de Velocity
- DamageSystem met à jour Health en fonction de DamageTag
- RenderSystem lit Position et rend
- PhysicsSystem gère les collisions

// Aucun système ne dépend directement de la sortie d'un autre
// Les données circulent par les composants
```

Ce **découplage** est la raison pour laquelle ECS se met à l'échelle. Ajouter un nouveau système ? Aucune refactorisation nécessaire—définissez-en simplement un nouveau.

## Résumé de l'API

| Fonction | Description |
|---|---|
| `defineSystem(setup)` | Déclarer un système |
| `useQuery(components, opts?)` | Ensemble d'entités réactif correspondant aux composants |
| `onUpdate(cb)` | Enregistrer le callback de frame |
| `onBeforeUpdate(cb)` | Enregistrer le callback de pré-mise à jour |
| `onAfterUpdate(cb)` | Enregistrer le callback de post-mise à jour |
| `onRender(cb)` | Enregistrer le callback de phase de rendu |
| `useEngine()` | Accéder à l'instance du moteur |
| `usePhysics2D()` | Accéder au service de physique |
| `useService(key)` | Accéder à un service enregistré via `engine.provide()` |
| `useWasmModule(name)` | Accéder à un module WASM chargé via `engine.loadWasmModule()` |
| `addComponent(id, Component, data)` | Ajouter un composant à une entité |
| `removeComponent(id, Component)` | Retirer un composant d'une entité |

## Prochaines étapes

- **[Composants](/fr/essentials/components)** — Définir les données que vos systèmes vont manipuler.
- **[Architecture](/fr/essentials/architecture)** — Comprendre comment les systèmes s'intègrent dans l'ECS.
- **[Scènes et Acteurs](/fr/essentials/scenes)** — Apprendre à organiser les systèmes dans les scènes.
