---
title: Acteurs
description: Objets de jeu composables basés sur des instances, avec leur propre entité et cycle de vie.
---

# Acteurs

Un **acteur** est un objet de jeu composable basé sur des instances. Chaque instance d'acteur possède une seule entité ECS et exécute des crochets de cycle de vie (`onStart`, `onUpdate`, `onDestroy`) indépendamment. Les acteurs sont définis avec `defineActor()` et enregistrés avec `engine.use()`.

## Définir un acteur

`defineActor(prefab, factory)` prend un préfabriqué (disposition des composants) et une fonction factory qui configure les crochets de cycle de vie et retourne une API publique :

```ts
import { defineActor, onStart, onDestroy, onUpdate } from '@gwenjs/core'
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

Enregistrez le plugin de l'acteur avec le moteur avant de générer :

```ts
// main.ts
import { createEngine } from '@gwenjs/core'
import { EnemyActor } from './actors/Enemy'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(EnemyActor._plugin)
await engine.start()
```

## Génération et suppression

```ts
// Générer — retourne l'ID d'entité
const id = EnemyActor._plugin.spawn({ hp: 100 })

// Supprimer — appelle onDestroy et supprime l'entité
EnemyActor._plugin.despawn(id)

// Obtenir une référence (si vous avez stocké l'ID)
const actor = EnemyActor._plugin.get(id)
actor.takeDamage(10)
```

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

## Accéder aux composants

Utilisez `useComponent()` pour obtenir et muter un composant :

```ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core'
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
import { defineActor, useSceneRouter, onUpdate, useComponent } from '@gwenjs/core'
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
import { definePrefab } from '@gwenjs/core'
import { Position, Velocity, Health } from '../components'

export const EnemyPrefab = definePrefab({
  Position: { x: 0, y: 0 },
  Velocity: { x: 0, y: 0 },
  Health: { hp: 50, maxHp: 50 },
})

// src/actors/Enemy.ts
import { defineActor, onStart, onUpdate, onDestroy, useComponent } from '@gwenjs/core'
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

// src/main.ts
import { createEngine } from '@gwenjs/core'
import { EnemyActor } from './actors/Enemy'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(EnemyActor._plugin)
await engine.start()

// Générer quelques ennemis
EnemyActor._plugin.spawn({ speed: 50 })
EnemyActor._plugin.spawn({ speed: 75 })
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
| `actor._plugin.spawn(props)` | Générer une instance (retourne l'ID d'entité) |
| `actor._plugin.despawn(id)` | Supprimer une instance |
| `actor._plugin.get(id)` | Obtenir la référence API publique |
| `useComponent(ComponentType)` | Accéder à un composant à l'intérieur de factory |
| `useSceneRouter(router)` | Naviguer entre les scènes |
| `onStart(fn)` | S'exécute une fois à la génération |
| `onUpdate(fn)` | S'exécute chaque frame |
| `onDestroy(fn)` | S'exécute à la suppression |

## Prochaines étapes

- **[Préfabriqués](/fr/essentials/prefabs)** — Définir la disposition des composants pour les acteurs.
- **[Routeur de scènes](/fr/essentials/scene-router)** — Naviguer entre les scènes depuis les acteurs.
- **[Systèmes](/fr/essentials/systems)** — Implémenter la logique en masse qui s'exécute sur plusieurs entités.
