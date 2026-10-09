---
title: Détection de leaks d'acteurs
description: Détecter et prévenir les fuites d'instances d'acteurs avec watchActorLeaks.
---

# Détection de leaks d'acteurs

Les leaks d'acteurs sont l'un des bugs de performance les plus courants dans les jeux GWEN : des acteurs sont spawnés chaque frame (ou à chaque entrée de scène) mais ne sont jamais despawnés. Le résultat est une croissance mémoire illimitée — les Maps `_instances` grossissent indéfiniment, l'itération par frame ralentit, et le ramasse-miettes devient coûteux.

Cette page explique comment détecter ces fuites à l'exécution et comment les prévenir.

## Qu'est-ce qu'un leak d'acteur ?

Chaque appel à `actor.spawn()` crée une `ActorInstance` en mémoire : des tableaux de callbacks, un `bigint` pour l'ID d'entité, des handles composables, et l'API publique de votre acteur. Quand `despawn()` ou `despawnAll()` n'est jamais appelé, ces instances s'accumulent pour toute la durée de vie de l'application.

Les deux causes les plus fréquentes :

**1. Spawn dans `onUpdate` sans despawn correspondant**

```ts
// ❌ crée une nouvelle instance chaque frame — jamais supprimée
export const ShootingSystem = defineSystem(() => {
  const bullet = useActor(BulletActor)

  onUpdate(() => {
    bullet.spawn({ x: player.x, y: player.y }) // ← fuite si aucun despawn correspondant
  })
})
```

**2. Une scène qui spawne des acteurs mais oublie `onExit`**

```ts
// ❌ les acteurs survivent aux transitions de scène
const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const enemies = useActor(EnemyActor)

  onEnter(() => {
    player.spawnOnce()
    enemies.spawn({ hp: 100 })
  })
  // manquant : onExit(() => { player.despawnAll(); enemies.despawnAll() })
})
```

## Détecter les fuites avec `watchActorLeaks`

`watchActorLeaks` interroge un ensemble de définitions d'acteurs à intervalle fixe. Quand il observe que le nombre d'instances vivantes d'un acteur croît N fois de suite sans jamais diminuer, il émet un `console.warn` pointant vers le pattern `despawnAll()`.

```ts
import { watchActorLeaks } from '@gwenjs/core/actor'

// main.ts — développement uniquement
if (__GWEN_DEV__) {
  watchActorLeaks([PlayerActor, EnemyActor, BulletActor])
}
```

Quand une fuite est détectée, vous verrez :

```
[GWEN] Possible actor leak detected: "BulletActor" has 847 live instances
(+14 since last check). Call despawn() or despawnAll() when done,
or add onExit(() => actor.despawnAll()) to the enclosing scene.
```

L'avertissement ne se déclenche qu'après `growthStreak` intervalles de croissance consécutifs, de sorte que les patterns de spawn en rafale (spawner beaucoup de balles d'un coup, puis les nettoyer) ne génèrent pas de faux positifs.

### Options

```ts
watchActorLeaks(actorDefs, {
  intervalMs: 5_000,   // fréquence de vérification (défaut : 5000ms)
  growthStreak: 3,     // intervalles consécutifs en croissance avant avertissement (défaut : 3)
  onLeak: (name, count, delta) => {
    // reporter personnalisé — reçoit le nom de l'acteur, le count actuel et le delta
    myTelemetry.warn('actor-leak', { name, count, delta })
  },
})
```

| Option | Type | Défaut | Description |
|---|---|---|---|
| `intervalMs` | `number` | `5000` | Intervalle de vérification en millisecondes |
| `growthStreak` | `number` | `3` | Observations de croissance consécutives pour déclencher `onLeak` |
| `onLeak` | `function` | `console.warn` | Appelé quand une fuite est détectée |

Avec plusieurs moteurs : sans l'option `engine`, les compteurs sont lus sur le moteur courant à l'appel (ou sur le seul moteur qui a installé l'acteur). Si aucun moteur n'est courant et qu'un acteur est installé sur deux moteurs ou plus, l'appel lève `GwenContextError`. Si un second moteur installe l'acteur plus tard, chaque tick ignore cet acteur et continue de surveiller les autres. Passez `engine` pour le surveiller.

### Arrêter le monitoring

`watchActorLeaks` retourne une fonction `stop`. Appelez-la avant le teardown du moteur ou dans un `afterEach` de test :

```ts
const stop = watchActorLeaks([BulletActor])

// plus tard…
stop()
```

::: tip Tree-shaking
Enveloppez l'appel dans `if (__GWEN_DEV__)` pour que les builds de production le suppriment. À l'exécution, seul `setInterval` est utilisé — zéro coût en production.
:::

## Corriger les fuites

### Acteurs de scène : toujours coupler `onEnter` avec `onExit`

```ts
const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const enemies = useActor(EnemyActor)

  onEnter(() => {
    player.spawnOnce()
    enemies.spawn({ hp: 100 })
  })

  // ✅ les acteurs sont supprimés lors de la transition de scène
  onExit(() => {
    player.despawnAll()
    enemies.despawnAll()
  })
})
```

### Acteurs dynamiques : suivre et despawner individuellement

```ts
export const ShootingSystem = defineSystem(() => {
  const bullet = useActor(BulletActor)
  const liveIds: bigint[] = []

  onUpdate((dt) => {
    if (shouldShoot) {
      const id = bullet.spawn({ x: player.x, y: player.y })
      liveIds.push(id)
    }

    // Despawner les balles sorties de l'écran
    for (let i = liveIds.length - 1; i >= 0; i--) {
      const id = liveIds[i]!
      if (isOffScreen(id)) {
        bullet.despawn(id)
        liveIds.splice(i, 1)
      }
    }
  })
})
```

### Acteurs singleton : utiliser `spawnOnce`

```ts
onEnter(() => {
  // spawnOnce() est idempotent — sûr même si l'acteur est déjà vivant
  player.spawnOnce({ x: 400, y: 530 })
})
```

## Tester le cycle de vie des acteurs

Écrivez des tests qui assertent que `_instances.size === 0` après la sortie d'une scène — ils échouent immédiatement si un despawn est manquant :

```ts
import { describe, it, expect } from 'vitest'
import { createEngine } from '@gwenjs/core'

describe('GameScene lifecycle', () => {
  it('despawne tous les acteurs quand la scène sort', async () => {
    const engine = await createEngine({ maxEntities: 100 })

    // entrer dans la scène
    await engine.hooks.callHook('scene:enter', {})
    expect(PlayerActor._instances.size).toBe(1)
    expect(EnemyActor._instances.size).toBe(3)

    // sortir de la scène
    await engine.hooks.callHook('scene:exit', {})

    // ✅ rien ne reste — pas de fuite
    expect(PlayerActor._instances.size).toBe(0)
    expect(EnemyActor._instances.size).toBe(0)
  })
})
```

Combinés avec `watchActorLeaks` en mode dev, les tests de cycle de vie sont le moyen le plus fiable d'empêcher les leaks d'acteurs d'atteindre la production.

## Utiliser les snapshots de heap

Pour les fuites plus difficiles à attribuer, l'onglet **Memory** des DevTools Chrome permet de comparer des snapshots dans le temps. En comparant deux snapshots, filtrez la liste des constructeurs par les closures qui vous intéressent : cherchez `get world`, `setPosition`, `translate`, ou d'autres noms de méthodes de `useTransform`.

Si leurs counts croissent linéairement entre les snapshots, le type d'acteur correspondant fuit.

```
Snapshot 1 → Snapshot 2 → Snapshot 3

closure::get world     782 → 2 885 → 5 533   (+4 751)  ← fuite
closure::setPosition   782 → 2 885 → 5 533   (+4 751)  ← même acteur
bigint::bigint         787 → 2 890 → 5 538   (+4 751)  ← IDs d'entités
```

Chaque appel à `useTransform()` crée un `TransformHandle` avec ces méthodes. Un count qui croît au même rythme que les bigints d'IDs d'entités de l'acteur signifie une correspondance exacte — ce type d'acteur fuit précisément ce nombre d'instances.

## Référence API

| Export | Depuis |
|---|---|
| `watchActorLeaks(defs, options?)` | `@gwenjs/core/actor` |
| `WatchActorLeaksOptions` | `@gwenjs/core/actor` |

## Prochaines étapes

- **[Mode debug](/fr/advanced/debug-mode)** — Flags de debug globaux, journalisation et overlays de timing.
- **[Acteurs](/fr/essentials/actors)** — Cycle de vie des acteurs : spawn, despawn et API publique.
- **[Scènes](/fr/essentials/scenes)** — Comment `onEnter` et `onExit` s'intègrent dans les transitions de scène.