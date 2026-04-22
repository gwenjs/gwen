---
title: Routeur de scènes
description: Navigation entre scènes basée sur un automate fini avec des transitions typées.
---

# Routeur de scènes

Le **routeur de scènes** orchestre les transitions entre scènes à l'aide d'un automate fini. Définissez des états et des transitions une fois ; naviguez par programmation depuis les systèmes ou les scènes.

> Les scènes sont définies séparément avec `defineScene()`. Voir [Scènes](/fr/essentials/scenes).

::: info Auto-imports
`defineSceneRouter` et `useSceneRouter` sont auto-importés. Créez votre routeur dans `src/router.ts` et importez-le là où vous appelez `useSceneRouter`.
:::

## Les bases

`defineSceneRouter()` déclare les états et les transitions. Toutes les cibles d'état sont validées au moment de la définition — les erreurs sont levées immédiatement, pas au runtime.

```ts
import { defineSceneRouter } from '@gwenjs/core/scene'
import { MenuScene, GameScene, GameOverScene } from './scenes'

export const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: {
      scene: MenuScene,
      on: { START: 'game' },
    },
    game: {
      scene: GameScene,
      on: { PAUSE: 'pause', GAME_OVER: 'gameOver' },
    },
    gameOver: {
      scene: GameOverScene,
      on: { RESTART: 'game', MENU: 'menu' },
    },
  },
})
```

::: tip Aucune inscription nécessaire
`defineSceneRouter` est autonome. Créez-le simplement dans `src/router.ts` et importez-le là où vous avez besoin de `useSceneRouter`. Aucune entrée dans `gwen.config.ts` n'est requise.
:::

## Naviguer

Appelez `useSceneRouter(router)` à l'intérieur d'un système ou d'une scène pour obtenir le handle, puis utilisez `nav.send()` pour déclencher les transitions.

**Depuis un système :**

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { useSceneRouter } from '@gwenjs/core/scene'
import { AppRouter } from '../router'

export const GameOverSystem = defineSystem(() => {
  const nav = useSceneRouter(AppRouter)

  onUpdate(() => {
    if (noLivesRemaining) {
      nav.send('GAME_OVER')
    }
  })
})
```

**Depuis une scène :**

```ts
import { defineScene, onEnter } from '@gwenjs/core/scene'
import { useSceneRouter } from '@gwenjs/core/scene'
import { AppRouter } from '../router'

export const MenuScene = defineScene('menu', () => {
  const nav = useSceneRouter(AppRouter)

  onEnter(() => {
    const { difficulty } = nav.params  // lire les paramètres de la transition précédente
  })
})
```

## API du handle

| | |
|---|---|
| `nav.send(event, params?)` | Déclencher une transition (async) |
| `nav.can(event)` | Vérifier si la transition est valide dans l'état actuel |
| `nav.current` | Nom de l'état actuel |
| `nav.params` | Paramètres passés à l'état actuel |
| `nav.onTransition(fn)` | S'abonner aux changements d'état ; retourne une fonction de désabonnement |

## Passer des paramètres

Passez des données lors du déclenchement d'une transition. Lisez-la dans la scène cible via `nav.params` ou dans `onEnter(params)` :

```ts
// Déclencher avec des paramètres
nav.send('START', { level: 2, difficulty: 'hard' })

// Lire dans la scène cible via le callback onEnter
export const GameScene = defineScene('game', () => {
  onEnter((params) => {
    console.log('Level:', params?.level)
  })
})

// Ou via nav.params
const nav = useSceneRouter(AppRouter)
onEnter(() => {
  const { level } = nav.params
})
```

## Scènes superposées

Définissez `overlay: true` pour garder la scène précédente chargée et rendue derrière la nouvelle :

```ts
export const AppRouter = defineSceneRouter({
  initial: 'game',
  routes: {
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
    pause: {
      scene: PauseScene,
      overlay: true,
      on: { RESUME: 'game' },
    },
  },
})
```

Lors de la transition vers `pause` :
- La scène du jeu **reste chargée** (les systèmes continuent de s'exécuter)
- `onExit` n'est **pas appelé** sur la scène du jeu
- `onEnter` **est appelé** sur la scène de pause

Quand vous revenez de `pause` :
- `onExit` est appelé sur la scène de pause
- La scène du jeu **reprend immédiatement** (`onEnter` n'est pas appelé à nouveau)

## Écouter les transitions

`nav.onTransition(fn)` s'abonne à tous les changements d'état. Elle retourne une fonction de désabonnement :

```ts
const unsubscribe = nav.onTransition((from, to, params) => {
  console.log(`Transitioned from ${from} to ${to}`)
})

// Plus tard, pour arrêter l'écoute :
unsubscribe()
```

## Animations de transition

Pour jouer des animations autour des changements de scène, utilisez `onTransitionLeave` et `onTransitionEnter` dans la scène. Voir [Scènes — Animations de transition](/fr/essentials/scenes#animations-de-transition).

## Validation

`defineSceneRouter()` valide au moment de la définition :
- `initial` doit être une clé dans `routes`
- Toutes les cibles de transition doivent être des clés de route valides

Les erreurs sont levées immédiatement au démarrage du développement, pas au runtime.

## Résumé de l'API

| | |
|---|---|
| `defineSceneRouter(options)` | Déclarer la FSM avec les routes et l'état initial |
| `useSceneRouter(router)` | Obtenir le handle au runtime (contexte système ou scène) |
| `nav.send(event, params?)` | Déclencher une transition (async) |
| `nav.can(event)` | Vérifier si la transition est valide |
| `nav.current` | Nom de l'état actuel |
| `nav.params` | Paramètres passés à l'état actuel |
| `nav.onTransition(fn)` | S'abonner aux changements d'état ; retourne une fonction de désabonnement |

## Étapes suivantes

- **[Scènes](/fr/essentials/scenes)** — Hooks de cycle de vie et d'animation de transition.
- **[Systèmes](/fr/essentials/systems)** — Naviguer depuis les systèmes.
- **[Hooks](/fr/essentials/hooks)** — Réagir aux événements `scene:enter` et `scene:leave`.
