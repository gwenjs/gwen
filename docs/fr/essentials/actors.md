---
title: Acteurs
description: Objets de jeu composables basés sur des instances, avec leur propre entité et cycle de vie.
---

# Acteurs

Un **acteur** est un objet de jeu composable basé sur des instances. Chaque instance d'acteur possède une seule entité ECS et exécute des crochets de cycle de vie (`onStart`, `onUpdate`, `onDestroy`) indépendamment. Les acteurs sont définis avec `defineActor()` et enregistrés avec `engine.use()`.

## Définir un acteur

`defineActor(prefab, factory)` prend un préfabriqué (disposition des composants) et une fonction factory qui configure les crochets de cycle de vie et retourne une API publique :

```ts
import { defineActor, onStart, onDestroy, onUpdate } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  onStart(() => {
    console.log('Enemy spawned, hp:', hp)
  })

  onUpdate((dt) => {
    // runs every frame for this instance
  })

  onDestroy(() => {
    console.log('Enemy destroyed')
  })

  return {
    takeDamage: (amount: number) => { hp -= amount },
    getHp: () => hp,
  }
})
```

La fonction factory reçoit :
- `props` — Données personnalisées passées lors de la génération
- Crochets de cycle de vie — `onStart`, `onUpdate`, `onDestroy`, etc.

L'objet retourné est l'**API publique** — les méthodes que le code externe peut appeler sur l'acteur.

## Enregistrement

Enregistrez le plugin de l'acteur avec le moteur avant de générer. Passez `actor._plugin` à `engine.use()` au démarrage.

## Génération et suppression

Utilisez `useActor()` dans la phase de setup d'un système ou d'un acteur pour obtenir un handle typé :

```ts
import { useActor } from '@gwenjs/core/actor'
import { defineSystem } from '@gwenjs/core/system'
import { EnemyActor } from './actors/enemy'

export const SpawnerSystem = defineSystem(() => {
  const enemies = useActor(EnemyActor)

  // Générer — retourne l'ID d'entité
  const id = enemies.spawn({ hp: 100 })

  // Supprimer — appelle onDestroy et retire l'entité
  enemies.despawn(id)

  // Obtenir l'API publique de la première instance vivante
  const enemy = enemies.get()
  enemy?.takeDamage(10)

  // Obtenir toutes les instances vivantes
  for (const e of enemies.getAll()) {
    e.takeDamage(5)
  }

  // Supprimer toutes les instances d'un coup
  enemies.despawnAll()
})
```

`useActor()` retourne un `ActorHandle` avec :

| Méthode | Description |
|---|---|
| `spawn(props?)` | Créer une instance, retourne l'ID d'entité |
| `despawn(id)` | Supprimer une instance spécifique |
| `despawnAll()` | Supprimer toutes les instances vivantes |
| `count()` | Nombre d'instances vivantes |
| `get()` | API publique de la première instance vivante (`undefined` si aucune) |
| `getAll()` | API publique de toutes les instances vivantes |
| `spawnOnce(props?)` | Spawn singleton (sans effet si déjà vivant) |

## Composables de cycle de vie

Ces composables s'exécutent à l'intérieur de la fonction factory de l'acteur :

| Composable | Quand elle s'exécute |
|---|---|
| `onStart(fn)` | Une fois, immédiatement après la génération |
| `onUpdate(fn)` | Chaque frame (reçoit `dt` en ms) |
| `onBeforeUpdate(fn)` | Avant la phase de mise à jour principale |
| `onAfterUpdate(fn)` | Après la phase de mise à jour principale |
| `onRender(fn)` | Pendant la phase de rendu |
| `onDestroy(fn)` | Une fois, avant que l'entité ne soit supprimée |
| `onEvent(name, fn)` | Quand un crochet du moteur nommé se déclenche |

## Transform

Chaque instance d'acteur a accès à sa transform spatiale via `useTransform()`. Le handle opère directement sur le buffer mémoire WASM partagé — les vues restent toujours live après les appels `memory.grow()`.

```typescript
import { defineActor, useTransform, onStart } from '@gwenjs/core/actor'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, (props: { x: number; y: number }) => {
  const transform = useTransform()

  onStart(() => {
    transform.setPosition(props.x, props.y, 0)
    transform.setScale(1, 1, 1)
  })

  return {}
})
```

Méthodes du `TransformHandle` :

| Méthode | Description |
|---|---|
| `setPosition(x, y, z)` | Définir la position dans le monde |
| `setRotation(rx, ry, rz)` | Définir la rotation Euler (radians) |
| `setScale(sx, sy, sz)` | Définir l'échelle |

## Événements typés

Utilisez `defineEvents()` pour déclarer votre contrat d'événements de jeu en un seul endroit, puis partagez-le entre acteurs et systèmes.

```ts
// src/events/enemy.ts
import { defineEvents } from '@gwenjs/core/actor'

export const EnemyEvents = defineEvents({
  'enemy:hit': (damage: number) => {},
  'enemy:die': () => {},
})
```

`defineEvents` est un outil de déclaration — il nomme et groupe vos événements pour que chaque partie de votre code fonctionne à partir du même contrat.

### Émission d'événements

Appelez `emit()` depuis à l'intérieur d'un acteur ou d'un système pour déclencher un événement :

```ts
import { defineActor, emit } from '@gwenjs/core/actor'
import { EnemyEvents } from '../events/enemy'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  return {
    takeDamage: (damage: number) => {
      hp -= damage
      emit('enemy:hit', damage)
      if (hp <= 0) emit('enemy:die')
    },
  }
})
```

### Écoute depuis un acteur

Utilisez `onEvent()` à l'intérieur d'une factory `defineActor` pour écouter. Le handler est automatiquement supprimé quand l'acteur est détruit — aucun nettoyage nécessaire :

```ts
import { defineActor, onEvent, onStart } from '@gwenjs/core/actor'
import { HUDPrefab } from '../prefabs'

export const HUDActor = defineActor(HUDPrefab, () => {
  let hits = 0

  onEvent('enemy:hit', (damage) => {
    hits++
    console.log(`Enemy hit for ${damage} damage (total hits: ${hits})`)
  })

  onEvent('enemy:die', () => {
    console.log('Enemy eliminated')
  })

  return {}
})
```

### Écoute depuis un système

Utilisez `useHook()` à l'intérieur d'une configuration `defineSystem` pour écouter depuis un système. Il se désabonne automatiquement quand le moteur s'arrête :

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(function ScoreSystem() {
  let score = 0

  // Auto-cleanup when the engine stops
  useHook('enemy:die', () => {
    score += 100
    console.log('Score:', score)
  })

  useHook('enemy:hit', (damage) => {
    score += damage
  })
})
```

::: tip Convention de nommage
Préfixez les noms d'événements avec un espace de noms : `'enemy:hit'`, `'player:die'`, `'ui:open'`. Cela évite les collisions avec les hooks moteur intégrés comme `'engine:tick'` ou `'entity:spawn'`.
:::

## Accéder aux composants

Utilisez `useComponent()` pour obtenir et muter un composant :

```ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core/actor'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      // Gérer la mort
    }
  })

  return {}
})
```

## Accéder au routeur

À l'intérieur d'un acteur, utilisez `useSceneRouter()` pour naviguer entre les scènes :

```ts
import { defineActor, onUpdate, useComponent } from '@gwenjs/core/actor'
import { useSceneRouter } from '@gwenjs/core/scene'
import { AppRouter } from '../router'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('DIE')  // Transition vers fin de jeu
    }
  })

  return {}
})
```

## Exemple complet

```ts
// src/prefabs/Enemy.ts
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Health } from '../components'

export const EnemyPrefab = definePrefab({
  Position: { x: 0, y: 0 },
  Velocity: { x: 0, y: 0 },
  Health: { hp: 50, maxHp: 50 },
})

// src/actors/Enemy.ts
import { defineActor, onStart, onUpdate, onDestroy, useComponent } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs/Enemy'
import { Health, Velocity } from '../components'

export const EnemyActor = defineActor(EnemyPrefab, (props: { speed: number }) => {
  const health = useComponent(Health)
  const velocity = useComponent(Velocity)

  onStart(() => {
    console.log(`Enemy spawned with ${health.value.hp} HP`)
    velocity.value.x = Math.random() * props.speed - props.speed / 2
  })

  onUpdate(() => {
    if (health.value.hp <= 0) {
      // Sera supprimé
    }
  })

  onDestroy(() => {
    console.log('Enemy destroyed')
  })

  return {
    takeDamage: (amount: number) => {
      health.value.hp = Math.max(0, health.value.hp - amount)
    },
    getHp: () => health.value.hp,
  }
})
```

## Acteurs vs Systèmes

| | Acteur | Système |
|---|---|---|
| **Portée** | Par instance | Global |
| **Entité** | Possède une entité | Interroge plusieurs entités |
| **Cas d'usage** | Objets de jeu individuels (joueur, ennemis, projectiles) | Logique en masse (physique, balayage IA, collision) |
| **État** | Local à l'instance | Global |

Utilisez les acteurs pour les **entités uniques et nommées**. Utilisez les systèmes pour les **opérations en masse** sur des ensembles d'entités.

## Résumé de l'API

| | |
|---|---|
| `defineActor(prefab, factory)` | Créer un type d'acteur |
| `actor._plugin` | Le plugin à enregistrer avec `engine.use()` |
| `useActor(actorDef)` | Obtenir un handle typé (appeler en phase de setup) |
| `handle.spawn(props?)` | Générer une instance, retourne l'ID d'entité |
| `handle.despawn(id)` | Supprimer une instance spécifique |
| `handle.despawnAll()` | Supprimer toutes les instances vivantes |
| `handle.count()` | Nombre d'instances vivantes |
| `handle.get()` | API publique de la première instance vivante |
| `handle.getAll()` | API publique de toutes les instances vivantes |
| `handle.spawnOnce(props?)` | Spawn singleton (sans effet si déjà vivant) |
| `useComponent(ComponentType)` | Accéder à un composant à l'intérieur de factory |
| `useTransform()` | Accéder à la transform spatiale de l'acteur |
| `useSceneRouter(router)` | Naviguer entre les scènes |
| `defineEvents(map)` | Déclarer un contrat d'événements typé (partagé entre acteurs et systèmes) |
| `emit(event, ...args)` | Déclencher un événement depuis un contexte moteur actif |
| `onEvent(event, handler)` | Écouter un événement à l'intérieur d'un acteur (supprimé automatiquement à la destruction) |
| `useHook(event, handler)` | S'abonner à un événement moteur ou de jeu (nettoyage automatique) — importer depuis `@gwenjs/core` |
| `onStart(fn)` | S'exécute une fois à la génération |
| `onUpdate(fn)` | S'exécute chaque frame |
| `onDestroy(fn)` | S'exécute à la suppression |

## Prochaines étapes

- **[Préfabriqués](/fr/essentials/prefabs)** — Définir la disposition des composants pour les acteurs.
- **[Routeur de scènes](/fr/essentials/scene-router)** — Naviguer entre les scènes depuis les acteurs.
- **[Systèmes](/fr/essentials/systems)** — Implémenter la logique en masse qui s'exécute sur plusieurs entités.
