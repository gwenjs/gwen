---
title: Systèmes
description: Les systèmes contiennent toute la logique de jeu dans GWEN. Apprenez à les définir, injecter des dépendances, et contrôler leur cycle de vie.
---

# Systèmes

Un **système** est une fonction exécutée à chaque frame qui lit et écrit des données de composants. Les systèmes constituent la couche logique ECS de GWEN.

## Définir un système

Utilisez `defineSystem()` pour déclarer un système. Elle retourne une **fonction factory** — il faut l'appeler pour produire un plugin, puis passer ce plugin à `useSystem()` dans une scène.

```ts
import { defineSystem, onUpdate, useQuery } from '@gwenjs/core/system'
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

## Enregistrer des systèmes dans une scène

Appelez `useSystem()` une fois par système à l'intérieur de `defineScene()`. Chaque appel retourne un `SystemHandle` :

```ts
import { defineScene, useSystem } from '@gwenjs/core/scene'

export const GameScene = defineScene('game', () => {
  const movement = useSystem(MovementSystem())
  const render   = useSystem(RenderSystem())
})
```

## Nommage des systèmes

Le moteur utilise un nom pour identifier chaque système (déduplication et débogage). Avec `gwenVitePlugin`, le nom est **injecté automatiquement** depuis la variable exportée. Sans le plugin Vite (tests, Node.js), passez-le explicitement :

```ts
// ✅ Avec le plugin Vite — nom déduit de export const
export const MovementSystem = defineSystem(() => { ... })

// ✅ Sans le plugin Vite — nom explicite
export const MovementSystem = defineSystem('MovementSystem', () => { ... })
```

## Injection de dépendances

Les systèmes peuvent déclarer des dépendances typées comme paramètres. La scène les câble à l'initialisation, gardant le système découplé des types d'acteurs concrets.

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'

// Accepte tout objet avec une méthode takeDamage — pas lié à PlayerActor
export const CombatSystem = defineSystem((target: { takeDamage(n: number): void }) => {
  onUpdate(() => target.takeDamage(5))
})
```

Dans la scène :

```ts
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { useActor } from '@gwenjs/core/actor'

export const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)

  const movement = useSystem(MovementSystem())
  const combat   = useSystem(CombatSystem(player))  // player implémente l'interface

  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

## SystemHandle — Contrôle du cycle de vie

`useSystem()` retourne un `SystemHandle` :

```ts
interface SystemHandle {
  pause(): void    // stopper les callbacks de frame, état préservé
  resume(): void   // relancer les callbacks
  destroy(): void  // retirer définitivement du frame loop
  readonly active: boolean
}
```

```ts
const combat = useSystem(CombatSystem(player))

// Pendant une cinématique — mettre combat en pause
combat.pause()

// Après la cinématique
combat.resume()
```

### Pause et overlays de scène

Si un overlay de scène (ex. menu pause) gèle la scène sous-jacente, les systèmes sont automatiquement mis en pause par le moteur. Un système que vous avez mis en pause vous-même **ne sera pas** réactivé à la fermeture de l'overlay — seule la pause de scène du moteur est levée :

```ts
combat.pause()           // vous mettez combat en pause pendant une cinématique

// le joueur ouvre le menu pause → le moteur gèle tous les systèmes
// le joueur ferme le menu pause → le moteur relance les systèmes non mis en pause par l'utilisateur

// combat est toujours en pause car VOUS l'avez mis en pause
combat.resume()          // relancer explicitement à la fin de la cinématique
```

## Découverte automatique des dépendances d'acteurs

Si un système utilise `useActor()` en interne (pour des acteurs qu'il possède), GWEN découvre et installe automatiquement le plugin d'acteur — inutile de le déclarer séparément dans la scène :

```ts
export const SpawnSystem = defineSystem(() => {
  const asteroid = useActor(AsteroidActor)  // appartient à ce système
  onUpdate((dt) => {
    asteroid.spawn({ x: randomX(), y: -10 })
  })
})

// Dans la scène — pas besoin de useActor(AsteroidActor) explicite :
export const GameScene = defineScene('game', () => {
  useSystem(SpawnSystem())  // AsteroidActor est auto-découvert et installé
})
```

## Phases de frame

Enregistrez les callbacks dans la bonne phase :

| Composable | Phase | Utilisation typique |
|---|---|---|
| `onBeforeUpdate(dt)` | Avant physique/WASM | Lecture des inputs, pré-simulation |
| `onUpdate(dt)` | Mise à jour principale | Logique de jeu, IA, déplacement |
| `onAfterUpdate(dt)` | Post-mise à jour | Synchronisation d'état, score |
| `onRender()` | Rendu | Appels de dessin (pas de `dt`) |

```ts
export const InputSystem = defineSystem(() => {
  onBeforeUpdate((dt) => { /* lire les inputs */ })
  onUpdate((dt)       => { /* appliquer les déplacements */ })
  onAfterUpdate((dt)  => { /* mettre à jour le HUD de debug */ })
  onRender(()         => { /* dessiner l'overlay de debug */ })
})
```
