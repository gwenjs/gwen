---
title: Pool d'acteurs
description: Réutiliser les instances d'acteurs au lieu de les détruire pour réduire la pression GC et les coûts d'allocation.
---

# Pool d'acteurs

Dans la plupart des jeux, certains acteurs sont créés et détruits très fréquemment : ennemis,
projectiles, particules, effets de coup. Allouer une nouvelle entité ECS à chaque spawn génère
une pression GC et des ralentissements de frame imprévisibles. **Le pool d'acteurs** résout ce
problème en réutilisant un ensemble fixe d'entités au lieu de les détruire et recréer.

## Le problème

Chaque appel à `spawn()` alloue une `ActorInstance` en mémoire, ajoute des composants à l'ECS
et exécute la factory function. Quand `despawn()` est appelé, l'entité est détruite et tout son
état est libéré. Pour les acteurs à haute fréquence, ce cycle constant alloc/libération gaspille
du CPU et sollicite le ramasse-miettes.

```ts
// ❌ Chaque tir alloue une nouvelle entité — pression GC constante
onUpdate(() => {
  if (shooting) {
    const id = BulletActor._plugin.spawn({ speed: 800 })
    // ... bullet.despawn(id) plus tard — retour à la case départ
  }
})
```

## La solution : `defineActorPool`

Un pool maintient un nombre fixe d'entités en vie. Quand on en "despawn" une, elle devient
**dormante** au lieu d'être détruite. Le prochain appel à `acquire()` réutilise un slot dormant
instantanément, à coût d'allocation nul.

```ts
import { defineActorPool, useActorPool } from '@gwenjs/core/actor'

export const BulletPool = defineActorPool(BulletActor, { size: 200 })
```

## Configuration

Le pool expose un `_plugin` qui doit être enregistré dans le moteur, **après** le plugin de
l'acteur :

```ts
// main.ts
await engine.use(BulletActor._plugin)  // l'acteur en premier
await engine.use(BulletPool._plugin)   // puis le pool
```

## Utilisation

```ts
// Acquérir un slot (crée l'entité au premier appel, réutilise ensuite)
const id = BulletPool.acquire({ speed: 800, direction: Math.PI / 4 })

// Retourner au pool quand c'est fini (différé à fin de frame)
BulletPool.release(id)
```

`acquire()` est synchrone et retourne un `EntityId` comme `spawn()`.
`release()` est différé à `engine:afterTick` pour éviter les mutations mid-frame.

## Cycle de vie d'un acteur dans un pool

Ajoutez `onRelease` et `onReset` à côté de vos hooks lifecycle existants :

```ts
import { defineActor, onStart, onUpdate, onDestroy, onRelease, onReset } from '@gwenjs/core/actor'

export const BulletActor = defineActor(BulletPrefab, (props: BulletProps) => {
  const id = useEntityId()

  onStart(() => {
    // Appelé une fois au premier spawn — état initial
    Position.x[id] = props.x
    Velocity.vx[id] = props.speed * Math.cos(props.direction)
  })

  onRelease(() => {
    // Appelé quand retourné au pool — nettoyer l'état externe
    physics.removeBody(id)
    sounds.stop(id)
  })

  onReset((newProps: BulletProps) => {
    // Appelé à chaque réutilisation — reset avec les nouvelles props
    // (les defaults du prefab sont déjà réappliqués automatiquement)
    Position.x[id] = newProps.x
    Velocity.vx[id] = newProps.speed * Math.cos(newProps.direction)
    physics.addBody(id, { ... })
  })

  onDestroy(() => {
    // Appelé uniquement lors de pool.destroyAll() ou à l'arrêt du moteur
  })
})
```

| Hook | Quand il est appelé |
|---|---|
| `onStart` | Premier spawn uniquement |
| `onRelease` | Chaque `pool.release(id)` |
| `onReset` | Chaque `pool.acquire(props)` sur un slot réutilisé |
| `onDestroy` | `pool.destroyAll()` ou arrêt du moteur |

## Intégration avec les scènes

Utilisez `useActorPool()` dans une factory `defineScene` pour appeler `destroyAll()`
automatiquement à la sortie de la scène :

```ts
import { defineScene, onEnter } from '@gwenjs/core/scene'
import { useActorPool } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  useActorPool(BulletPool)
  // BulletPool.destroyAll() est appelé automatiquement à la sortie de la scène

  onEnter(() => {
    // Le pool est prêt
  })
})
```

## Intégration physique

Les moteurs physiques comme Rapier2D maintiennent leur propre simulation interne séparée de
l'ECS. Le corps physique d'un acteur dormant **continue de simuler** à moins que vous ne le
retiriez explicitement. Utilisez `onRelease` et `onReset` pour le gérer :

```ts
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const physics = usePhysics2D()
  const id = useEntityId()

  onRelease(() => {
    physics.removeBody(id)  // retirer du monde physique
  })

  onReset((props: EnemyProps) => {
    Position.x[id] = props.x
    Position.y[id] = props.y
    physics.addBody(id, { type: 'dynamic' })  // réintégrer dans le monde physique
  })
})
```

## Statistiques et monitoring

```ts
BulletPool.stats()
// {
//   size: 200,        — capacité maximale
//   active: 47,       — slots actuellement acquis
//   available: 153,   — slots dormants prêts à la réutilisation
//   peakActive: 91,   — pic historique (utile pour dimensionner le pool)
//   acquireCount: 842 — total d'acquisitions depuis la création du pool
// }
```

`peakActive` est la métrique la plus utile pour calibrer `size` : jouez une session complète,
puis réglez `size` sur `peakActive + 20%` de marge de sécurité.

## Hooks observables

Réagissez aux événements du pool depuis l'extérieur :

```ts
BulletPool.hooks.hook('pool:warn',     ({ ratio }) => console.warn('pool sous pression', ratio))
BulletPool.hooks.hook('pool:critical', ({ active, size }) => spawnRateController.reduce())
BulletPool.hooks.hook('pool:acquire',  ({ id }) => analytics.track('bullet-spawn'))
BulletPool.hooks.hook('pool:release',  ({ id }) => analytics.track('bullet-release'))
```

| Hook | Se déclenche quand |
|---|---|
| `pool:acquire` | Juste avant qu'un slot soit retourné à l'appelant |
| `pool:release` | Après qu'un slot soit mis en état dormant |
| `pool:warn` | Les slots actifs dépassent `warnThreshold` (défaut 80%) |
| `pool:critical` | Les slots actifs dépassent `criticalThreshold` (défaut 95%) |
| `pool:exhausted` | Tous les slots sont actifs — juste avant le throw |

## Épuisement du pool

Quand `acquire()` est appelé et tous les slots sont actifs, une `PoolExhaustedError` est levée.
Le logger du moteur émet aussi un message de niveau `error`. Gérez-le avec un `try/catch` :

```ts
try {
  const id = BulletPool.acquire({ speed: 800, x: player.x, y: player.y })
} catch (e) {
  if (e instanceof PoolExhaustedError) {
    // Pool plein — ignorer ce spawn ou le mettre en file d'attente
  }
}
```

::: tip Dimensionner le pool
Si l'épuisement se produit régulièrement, augmentez `size`. Si `peakActive` dans `stats()` est
bien inférieur à `size`, réduisez-le. Des événements `pool:warn` fréquents non résolus suggèrent
qu'un appel `release()` est manquant quelque part.
:::

## Allocation paresseuse

Les entités sont allouées à la demande — les `size` premiers appels à `acquire()` créent chacun
une nouvelle entité. Les appels suivants réutilisent des slots dormants. Cela signifie :

- Aucun coût au démarrage : rien n'est alloué avant le premier `acquire()`.
- Les N premiers spawns ont un coût d'allocation complet (factory + création d'entité ECS).
- Tous les spawns suivants une fois le pool rempli sont quasi-gratuits.

Si votre jeu spawne un grand nombre d'acteurs d'un coup au début d'un niveau, envisagez un
préchauffage manuel dans `onEnter` :

```ts
onEnter(async () => {
  // Pré-remplir le pool avant le gameplay pour éviter les ralentissements
  const ids = Array.from({ length: 50 }, () => BulletPool.acquire())
  for (const id of ids) BulletPool.release(id)
  await engine.advance(16) // vider la file de releases
})
```

## Scope du cycle de vie

| Scope | Comportement |
|---|---|
| `useActorPool(pool)` dans une scène | `destroyAll()` à la sortie de la scène |
| `scope: 'global'` | `destroyAll()` à `engine:stop` |
| `scope: CustomScope` | `onMount` à l'installation, `onUnmount` à l'arrêt |
| Aucun (défaut) | Gestion manuelle de `destroyAll()` |

## Référence API

| Export | Depuis |
|---|---|
| `defineActorPool(actor, options)` | `@gwenjs/core/actor` |
| `useActorPool(pool)` | `@gwenjs/core/actor` |
| `onRelease(fn)` | `@gwenjs/core/actor` |
| `onReset(fn)` | `@gwenjs/core/actor` |
| `DormantTag` | `@gwenjs/core/actor` |
| `PoolExhaustedError` | `@gwenjs/core/actor` |
| `ActorPool<Props, PublicAPI>` | `@gwenjs/core/actor` |
| `PoolOptions` | `@gwenjs/core/actor` |
| `PoolStats` | `@gwenjs/core/actor` |
| `PoolHooks` | `@gwenjs/core/actor` |

## Prochaines étapes

- **[Détection de leaks d'acteurs](/fr/advanced/actor-leak-detection)** — Détecter les acteurs qui ne sont jamais despawnés ou relâchés.
- **[Acteurs](/fr/essentials/actors)** — Cycle de vie des acteurs : spawn, despawn et API publique.
- **[Hooks et événements](/fr/advanced/hooks)** — Le système de hooks du moteur utilisé par les événements du pool.
