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
const bullets = useActor(BulletActor)

onUpdate(() => {
  if (shooting) {
    const id = bullets.spawn({ speed: 800 })
    // bullets.despawn(id) plus tard — retour à la case départ à chaque frame
  }
})
```

## La solution : `defineActorPool`

Un pool maintient un nombre fixe d'entités en vie. Quand on en "despawn" une, elle devient
**dormante** au lieu d'être détruite. Le prochain appel à `acquire()` réutilise un slot dormant
instantanément, à coût d'allocation nul.

```ts
// pools/BulletPool.ts
import { defineActorPool } from '@gwenjs/core/actor'
import { BulletActor } from '../actors/BulletActor'

export const BulletPool = defineActorPool(BulletActor, { size: 200 })
```

## Intégration avec les scènes

Appelez `useActorPool()` dans une factory `defineScene`. Il installe le pool dans la scène,
enregistre le nettoyage à la sortie, et **retourne le pool** pour que vous puissiez le passer
aux systèmes et acteurs qui en ont besoin.

```ts
import { defineScene, onEnter, useSystem } from '@gwenjs/core/scene'
import { useActor, useActorPool } from '@gwenjs/core/actor'
import { BulletPool } from '../pools/BulletPool'
import { ShootingSystem } from '../systems/ShootingSystem'
import { PlayerActor } from '../actors/PlayerActor'

export const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const bulletPool = useActorPool(BulletPool)

  useSystem(ShootingSystem(bulletPool))

  onEnter(() => {
    player.spawnOnce()
    // bulletPool.acquire() est prêt ici — tous les plugins sont installés
  })
  // bulletPool.destroyAll() est appelé automatiquement à la sortie de la scène
})
```

::: tip Les pools sont gérés par la scène
`useActorPool()` est la seule façon correcte d'utiliser un pool. N'importez pas la valeur
de `defineActorPool` pour appeler `.acquire()` directement depuis les systèmes ou acteurs —
passez plutôt le handle retourné par `useActorPool()`. Cela place l'installation des plugins,
le cycle de vie et le nettoyage sous le contrôle de la scène.
:::

## Passer le pool aux systèmes

Les systèmes qui ont besoin de spawner ou relâcher des acteurs poolés reçoivent le pool via
injection de dépendances — le pattern standard des paramètres `defineSystem` :

```ts
// systems/ShootingSystem.ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import type { ActorPool } from '@gwenjs/core/actor'
import type { BulletProps } from '../actors/BulletActor'

export const ShootingSystem = defineSystem(
  'ShootingSystem',
  (bulletPool: ActorPool<BulletProps, void>) => {
    onUpdate(() => {
      if (triggerPressed) {
        try {
          bulletPool.acquire({ speed: 800, x: player.x, y: player.y })
        } catch {
          // Pool épuisé — tir ignoré
        }
      }
    })
  },
)
```

```ts
// GameScene.ts
const bulletPool = useActorPool(BulletPool)
useSystem(ShootingSystem(bulletPool))  // pool injecté en argument
```

## Passer le pool aux acteurs via les props

Quand un acteur a besoin d'acquérir depuis un pool (ex. un acteur manager qui écoute des
événements), passez le pool comme props de spawn :

```ts
// actors/ShooterManager.ts
import { useHook } from '@gwenjs/core'
import type { ActorPool } from '@gwenjs/core/actor'
import type { BulletProps } from './BulletActor'

export const ShooterManagerActor = defineActor(
  ShooterManagerPrefab,
  (props: { bulletPool: ActorPool<BulletProps, void> }) => {
    useHook('player:shoot', (x, y) => {
      try {
        props.bulletPool.acquire({ x, y, speed: 800 })
      } catch {
        // Pool épuisé — tir ignoré
      }
    })
    return {}
  },
)
```

```ts
// GameScene.ts
const manager = useActor(ShooterManagerActor)
const bulletPool = useActorPool(BulletPool)

onEnter(() => {
  manager.spawnOnce({ bulletPool })
})
```

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

## Se relâcher soi-même depuis l'acteur

Un acteur peut se relâcher lui-même dans le pool en appelant `pool.release()` — par exemple
quand il sort de l'écran. `release()` étant différé à `engine:afterTick`, il est sûr d'appeler
depuis un callback `onUpdate` :

```ts
export const BulletActor = defineActor(BulletPrefab, (props: { pool: ActorPool<BulletProps, void> }) => {
  const id = useEntityId()

  onUpdate(() => {
    if (Position.y[id] < 0) {
      props.pool.release(id)
    }
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
bulletPool.stats()
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

## Typer un paramètre pool

Trois niveaux de précision selon le besoin :

```ts
import type { ActorPool } from '@gwenjs/core/actor'

// Pool quelconque — quand les props concrètes n'ont pas d'importance
function logStats(pool: ActorPool) {
  console.log(pool.stats())
}

// Pool typé — quand tu appelles acquire() avec des props spécifiques
function spawnBullet(pool: ActorPool<BulletProps>) {
  pool.acquire({ speed: 800, x: 0, y: 0 })
}

// Pool exact — inféré depuis la définition, sans génériques à écrire
function spawnBullet(pool: typeof BulletPool) {
  pool.acquire({ speed: 800, x: 0, y: 0 })
}
```

`typeof BulletPool` est le plus ergonomique quand on fait référence à un pool précis —
TypeScript infère `Props` et `PublicAPI` automatiquement depuis l'appel à `defineActorPool`.
Utilise `ActorPool<Props>` pour écrire un utilitaire qui fonctionne avec n'importe quel pool
d'un type d'acteur donné.

## Hooks observables

Réagissez aux événements du pool depuis l'extérieur :

```ts
bulletPool.hooks.hook('pool:warn',     ({ ratio }) => console.warn('pool sous pression', ratio))
bulletPool.hooks.hook('pool:critical', ({ active, size }) => spawnRateController.reduce())
bulletPool.hooks.hook('pool:acquire',  ({ id }) => analytics.track('bullet-spawn'))
bulletPool.hooks.hook('pool:release',  ({ id }) => analytics.track('bullet-release'))
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
  bulletPool.acquire({ speed: 800, x: player.x, y: player.y })
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
  const ids = Array.from({ length: 50 }, () => bulletPool.acquire())
  for (const id of ids) bulletPool.release(id)
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
| `useActorPool(pool)` → `ActorPool` | `@gwenjs/core/actor` |
| `onRelease(fn)` | `@gwenjs/core/actor` |
| `onReset(fn)` | `@gwenjs/core/actor` |
| `DormantTag` | `@gwenjs/core/actor` |
| `PoolExhaustedError` | `@gwenjs/core/actor` |
| `ActorPool<Props, PublicAPI>` | `@gwenjs/core/actor` |
| `PoolOptions` | `@gwenjs/core/actor` |
| `PoolStats` | `@gwenjs/core/actor` |
| `PoolHooks` | `@gwenjs/core/actor` |

## Enregistrement manuel du plugin

::: info Automatique avec Gwen
Dans un projet Gwen standard, l'installation des plugins est gérée automatiquement —
`useActorPool()` les enregistre dans `ctx.systems` et le bootstrap Vite appelle `engine.use()`
sur chacun. Vous n'écrivez rien de tout cela vous-même.
:::

Si vous utilisez le moteur directement (setup personnalisé, tests, ou hors d'un projet Gwen
standard), enregistrez le plugin du pool manuellement **après** le plugin de l'acteur :

```ts
// main.ts — seulement nécessaire hors d'un projet Gwen standard
await engine.use(BulletActor._plugin)  // l'acteur en premier
await engine.use(BulletPool._plugin)   // puis le pool
```

## Prochaines étapes

- **[Détection de leaks d'acteurs](/fr/advanced/actor-leak-detection)** — Détecter les acteurs qui ne sont jamais despawnés ou relâchés.
- **[Acteurs](/fr/essentials/actors)** — Cycle de vie des acteurs : spawn, despawn et API publique.
- **[Hooks et événements](/fr/advanced/hooks)** — Le système de hooks du moteur utilisé par les événements du pool.
