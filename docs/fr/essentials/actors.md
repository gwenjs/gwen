---
title: Acteurs
description: Objets de jeu composables et basés sur des instances, avec leur propre entité et cycle de vie.
---

# Acteurs

Un **acteur** est un objet de jeu composable basé sur des instances. Chaque instance possède une seule entité ECS et exécute ses propres crochets de cycle de vie. Les acteurs sont définis avec `defineActor()` et déclarés dans les scènes via `useActor()`.

::: info Auto-imports
`defineActor`, `definePrefab`, `onStart`, `onDestroy`, `onEnable`, `onDisable`, `useActor`, `useTransform`, `useComponent`, `useEntityId`, `usePrefab` sont tous auto-importés. `onRelease` et `onReset` ne sont **pas** auto-importés — importez-les depuis `@gwenjs/core/actor`. `useHook` et `emit` ne sont **pas** auto-importés — importez-les depuis `@gwenjs/core`.
:::

## Les bases

`defineActor(prefab, factory)` prend un préfabriqué (disposition des composants) et une factory qui configure les crochets de cycle de vie :

```ts
import { defineActor, onStart, onDestroy } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  onStart(() => {
    console.log('spawned')
  })

  onDestroy(() => {
    console.log('destroyed')
  })
})
```

## Déclarer dans une scène

Déclarez l'acteur dans une scène en utilisant `useActor()` — cela l'enregistre et retourne un handle :

```ts
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { useActor } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  const enemy = useActor(EnemyActor)

  onEnter(() => enemy.spawn({ hp: 100 }))
  onExit(() => enemy.despawnAll())
})
```

## API de l'ActorHandle

`useActor()` retourne un `ActorHandle` combiné avec l'API publique de l'acteur :

| Méthode | Description |
|---|---|
| `spawn(props?)` | Créer une instance, retourne l'ID d'entité (`bigint`) |
| `spawnOnce(props?)` | Générer seulement s'aucune instance vivante n'existe |
| `despawn(id)` | Supprimer une instance spécifique |
| `despawnAll()` | Supprimer toutes les instances vivantes |
| `count()` | Nombre d'instances vivantes |
| `get()` | API publique de la première instance vivante (`undefined` si aucune) |
| `getAll()` | API publique de toutes les instances vivantes |

## Props

Passez des données typées lors de la génération :

```ts
export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number; speed: number }) => {
  let hp = props.hp
  let speed = props.speed

  // ...
})

// Dans la scène :
enemy.spawn({ hp: 50, speed: 2 })
```

## API publique

Retournez un objet depuis la factory pour exposer des méthodes sur le handle :

```ts
export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  return {
    takeDamage: (n: number) => { hp -= n },
    getHp: () => hp,
  }
})

// Dans un système ou une scène :
const enemy = useActor(EnemyActor)
enemy.get()?.takeDamage(10)     // première instance vivante
for (const e of enemy.getAll()) e.takeDamage(5)  // toutes les instances
```

## Hooks de frame

Les acteurs supportent les mêmes phases de frame que les systèmes :

```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  onBeforeUpdate((dt) => { /* lire l'entrée */ })
  onUpdate((dt)       => { /* appliquer le mouvement */ })
  onAfterUpdate((dt)  => { /* post-traitement */ })
  onRender(()         => { /* dessiner */ })
})
```

## Lire les données d'un composant

Utilisez `useComponent(def)` pour obtenir un proxy réactif des champs d'un composant sur cette instance d'acteur :

```ts
import { defineActor, useComponent, onUpdate } from '@gwenjs/core/actor'
import { Health, Velocity } from './components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)
  const velocity = useComponent(Velocity)

  onUpdate((dt) => {
    if (health.current <= 0) {
      // gérer la mort
    }

    // Écriture de champ unique
    velocity.x += 1

    // Écriture par lot — plus efficace pour plusieurs champs
    health.$set({ current: 80, max: 100 })
  })
})
```

`$set(values)` écrit tous les champs spécifiés en une seule opération — plus efficace que d'écrire les champs un par un lors de la mise à jour de plusieurs valeurs.

## Transformer

Utilisez `useTransform()` pour lire et écrire la transform spatiale de l'acteur :

```ts
import { defineActor, useTransform, onStart, onUpdate } from '@gwenjs/core/actor'

export const PlayerActor = defineActor(PlayerPrefab, (props: { x: number; y: number }) => {
  const transform = useTransform()

  onStart(() => {
    transform.setPosition(props.x, props.y)
  })

  onUpdate((dt) => {
    transform.translate(vx * dt, vy * dt)
    console.log(transform.world.x, transform.world.y)
  })
})
```

**Méthodes d'écriture** — mettent à jour la transform locale immédiatement :

| Méthode | Description |
|---|---|
| `translate(dx, dy)` | Déplacer par delta |
| `setPosition(x, y)` | Définir la position locale |
| `rotateTo(angle)` | Définir la rotation locale (radians) |
| `rotate(delta)` | Ajouter un delta à la rotation locale |
| `scaleTo(sx, sy?)` | Définir l'échelle locale (`sy` par défaut `sx`) |

**Propriétés en lecture** — valeurs monde, mises à jour une fois par frame :

| Propriété | Description |
|---|---|
| `world.x`, `world.y` | Position monde |
| `world.rotation` | Rotation monde (radians) |
| `world.scaleX`, `world.scaleY` | Échelle monde |
| `hasParent` | `true` si attaché à un parent |

**Hiérarchie :**

| Méthode | Description |
|---|---|
| `setParent(handleOrId, keepWorldPos?)` | Attacher à une entité parente |
| `detach(keepWorldPos?)` | Détacher du parent |

::: info Les lectures monde ont un frame de retard
`world.x/y` reflète l'état du **frame précédent**. Les écritures faites en `onUpdate` sont visibles au frame suivant.
:::

## Identifiant d'entité

Utilisez `useEntityId()` pour obtenir l'ID stable `bigint` de cette instance d'acteur :

```ts
import { defineActor, useEntityId, onUpdate } from '@gwenjs/core/actor'
import { Position } from './components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const entityId = useEntityId()

  onUpdate((dt) => {
    // Accès SoA direct — chemin le plus rapide
    Position.x[entityId] += Velocity.x[entityId] * dt
  })
})
```

::: info Temps de setup uniquement
`useEntityId()` doit être appelé pendant le corps de la factory synchrone, pas dans un callback.
:::

## Écouter des événements

Utilisez `useHook(name, fn)` pour vous abonner aux événements du moteur ou du jeu. L'abonnement est automatiquement supprimé quand l'acteur est despawné. Si l'acteur est dormant (pool), le handler est silencié (non supprimé).

```ts
import { defineActor, onStart } from '@gwenjs/core/actor'
import { useHook } from '@gwenjs/core'

export const HUDActor = defineActor(HUDPrefab, () => {
  useHook('enemy:die', () => {
    console.log('enemy killed')
  })

  useHook('score:add', (points: number) => {
    updateScoreDisplay(points)
  })
})
```

## Émettre des événements

Utilisez `emit(name, ...args)` pour déclencher des événements depuis un acteur. Tous les handlers enregistrés s'exécutent de manière synchrone avant le retour de `emit`.

```ts
import { defineActor, useComponent } from '@gwenjs/core/actor'
import { emit } from '@gwenjs/core'
import { Health } from './components'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const health = useComponent(Health)

  return {
    takeDamage: (n: number) => {
      health.current -= n
      emit('enemy:hit', n)
      if (health.current <= 0) emit('enemy:die')
    },
  }
})
```

## Accéder aux services

Utilisez `useService(key)` pour accéder à une valeur fournie par un plugin :

```ts
import { defineActor, onStart } from '@gwenjs/core/actor'
import { useService } from '@gwenjs/core/system'

export const AudioActor = defineActor(AudioPrefab, () => {
  const audio = useService('audio')

  onStart(() => {
    audio.play('spawn')
  })
})
```

## Hooks du cycle de vie du pool

Ces hooks ne sont pertinents que lors de l'utilisation de `defineActorPool`. Ils gèrent le cycle de dormance des acteurs gérés par le pool.

```ts
import { defineActor, onStart, onDestroy } from '@gwenjs/core/actor'
import { onRelease, onReset } from '@gwenjs/core/actor'
import { onEnable, onDisable } from '@gwenjs/core'

export const BulletActor = defineActor(BulletPrefab, () => {
  onStart(() => { /* première génération seulement */ })

  onReset((props) => {
    // Appelé avec de nouvelles props lors de la ré-acquisition du pool
    // Réinitialisez les données des composants ici
  })

  onEnable(() => {
    // Appelé après onReset — l'acteur est maintenant actif
  })

  onDisable(() => {
    // Appelé quand libéré au pool — l'acteur devient dormant
  })

  onRelease(() => {
    // Appelé après onDisable — nettoyer la physique, l'audio, les tweens
  })

  onDestroy(() => { /* pool complètement détruit */ })
})
```

| Hook | Quand |
|---|---|
| `onStart` | Première génération seulement |
| `onReset(props)` | Lors de la ré-acquisition du pool — réinitialisez les données des composants ici |
| `onEnable` | Après `onReset` — l'acteur est actif |
| `onDisable` | Quand libéré au pool — l'acteur devient dormant |
| `onRelease` | Après `onDisable` — nettoyer l'état externe |
| `onDestroy` | Pool complètement détruit |

::: info Chemins d'import pour les hooks du pool
`onRelease` et `onReset` sont depuis `@gwenjs/core/actor` mais ne sont **pas** auto-importés — ajoutez-les explicitement. `onEnable` et `onDisable` sont depuis `@gwenjs/core`, également non auto-importés.
:::

## Composables asynchrones

Les handles de composables (`useTransform()`, `useComponent()`, etc.) doivent être appelés pendant la **phase factory synchrone** — pas dans les callbacks asynchrones après `await`. Capturez-les pendant le setup et utilisez-les comme closures :

```ts
const PlayerActor = defineActor(PlayerPrefab, () => {
  const transform = useTransform()  // ✅ capturé de manière synchrone

  onStart(async () => {
    await loadPlayerSprite()
    transform.setPosition(400, 300)  // ✅ closure — aucun contexte nécessaire
  })
})
```

::: warning Non valide dans les acteurs
- ❌ `useSceneRouter` — les acteurs ne naviguent pas. Utilisez `emit` pour signaler une intention ; gérez la navigation dans un système.
- ❌ `useWasmModule` — API de niveau plugin, pas pour le code de jeu.
:::

## Acteurs vs Systèmes

| | Acteur | Système |
|---|---|---|
| **Portée** | Par instance | Global |
| **Entité** | Possède une entité | Interroge plusieurs entités |
| **Cas d'usage** | Objets de jeu nommés (joueur, boss, HUD) | Logique par lot (mouvement, IA, collision) |
| **État** | Local à l'instance | Global ou par requête |

## Résumé de l'API

| | |
|---|---|
| `defineActor(prefab, factory)` | Déclarer un type d'acteur |
| `useActor(def)` | Obtenir un handle typé (dans scène, système ou setup d'acteur) |
| `handle.spawn(props?)` | Générer une instance |
| `handle.spawnOnce(props?)` | Générer un singleton (sans effet si déjà vivant) |
| `handle.despawn(id)` | Despawner une instance spécifique |
| `handle.despawnAll()` | Despawner toutes les instances vivantes |
| `handle.count()` | Nombre d'instances vivantes |
| `handle.get()` | API publique de la première instance vivante |
| `handle.getAll()` | API publique de toutes les instances vivantes |
| `useEntityId()` | ID stable `bigint` pour cette instance (temps de setup) |
| `useComponent(def)` | Proxy réactif du composant — lire/écrire des champs, `$set` pour lot |
| `useTransform()` | Handle de transform spatiale |
| `useService(key)` | Accéder à un service fourni par un plugin |
| `useHook(name, fn)` | S'abonner à un événement (importer depuis `@gwenjs/core`) |
| `emit(name, ...args)` | Déclencher un événement (importer depuis `@gwenjs/core`) |
| `onStart(fn)` | S'exécute une fois à la première génération |
| `onDestroy(fn)` | S'exécute à la suppression |
| `onEnable(fn)` | Pool: après ré-acquisition (importer depuis `@gwenjs/core`) |
| `onDisable(fn)` | Pool: avant libération (importer depuis `@gwenjs/core`) |
| `onReset(fn)` | Pool: appelé avec de nouvelles props (importer depuis `@gwenjs/core/actor`) |
| `onRelease(fn)` | Pool: nettoyer l'état externe (importer depuis `@gwenjs/core/actor`) |

## Prochaines étapes

- **[Prefabs](/fr/essentials/prefabs)** — Définir la disposition des composants pour les acteurs.
- **[Scènes](/fr/essentials/scenes)** — Déclarer et contrôler les acteurs depuis une scène.
- **[Hooks](/fr/essentials/hooks)** — Définir des événements typés personnalisés.
- **[Systèmes](/fr/essentials/systems)** — Implémenter la logique par lot sur de nombreuses entités.
