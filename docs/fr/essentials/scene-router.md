---
title: Routeur de scènes
description: Navigation FSM basée sur les scènes avec transitions typées.
---

# Routeur de scènes

Le routeur de scènes de GWEN est une **machine à états finis (FSM)** : vous déclarez les scènes comme des états nommés et définissez quels événements déclenchent les transitions entre eux. Cela rend la navigation type-safe et prévisible.

## Définir un routeur

`defineSceneRouter()` déclare les états et les transitions :

```ts
import { defineSceneRouter } from '@gwenjs/core'
import { MenuScene } from './scenes/menu'
import { GameScene } from './scenes/game'
import { PauseScene } from './scenes/pause'
import { GameOverScene } from './scenes/game-over'

export const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu:     { scene: MenuScene,     on: { PLAY: 'game' } },
    game:     { scene: GameScene,     on: { PAUSE: 'pause', DIE: 'gameover' } },
    pause:    { scene: PauseScene,    overlay: true, on: { RESUME: 'game', QUIT: 'menu' } },
    gameover: { scene: GameOverScene, on: { RETRY: 'game', MENU: 'menu' } },
  },
})
```

- `initial` — l'état de démarrage (doit être une clé dans `routes`)
- `on` — mappe les noms d'événements aux états cibles
- `overlay: true` — la scène est rendue par-dessus la scène précédente (utile pour les menus de pause)

## Naviguer

Appelez `useSceneRouter()` à l'intérieur d'un acteur ou système pour obtenir un handle, puis appelez `.send()` pour déclencher les transitions :

```ts
import { defineActor, useSceneRouter, onUpdate, useComponent } from '@gwenjs/core'
import { AppRouter } from '../router'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('DIE')           // transition vers 'gameover'
    }
  })

  return {}
})
```

## API Handle

```ts
const nav = useSceneRouter(AppRouter)

nav.current          // nom d'état actuel, ex. 'game'
nav.params           // paramètres passés à l'état actuel
await nav.send('EVENT')    // déclencher une transition (async, retourne Promise<void>)
nav.can('EVENT')     // vérifier si l'événement est valide dans l'état actuel
nav.onTransition(fn) // s'abonner à toutes les transitions
```

## Passer des paramètres

Passez des données lors de l'envoi d'un événement :

```ts
nav.send('PLAY', { level: 2, difficulty: 'hard' })

// Dans la GameScene :
export const GameScene = defineScene('Game', (registry) => ({
  systems: [GameSystem],
  onEnter: async () => {
    const nav = useSceneRouter(AppRouter)
    const params = nav.params
    console.log('Starting level', params.level)
  },
}))
```

## Cycle de vie des scènes

Quand une transition se déclenche :
1. `onExit` de la scène actuelle est appelé (sauf si `overlay: true`)
2. `onEnter` de la scène cible est appelé
3. Les systèmes de l'ancienne scène sont désenregistrés, les nouveaux sont enregistrés

```ts
export const GameScene = defineScene('Game', (registry) => ({
  systems: [PlayerSystem, EnemySystem],
  
  onEnter: async () => {
    console.log('Game scene loaded!')
    await loadAssets()
  },
  
  onExit: () => {
    console.log('Game scene unloading')
    cleanup()
  },
}))
```

## Scènes en superposition

Définissez `overlay: true` pour garder la scène précédente chargée et rendue derrière la nouvelle :

```ts
const AppRouter = defineSceneRouter({
  initial: 'game',
  routes: {
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
    pause: {
      scene: PauseScene,
      overlay: true,  // Le jeu continue de s'exécuter derrière le menu de pause
      on: { RESUME: 'game' },
    },
  },
})
```

Quand vous transition vers `pause` :
- La scène du jeu **reste chargée** (les systèmes continuent de s'exécuter)
- La scène du jeu **continue de se rendre** (derrière l'UI de pause)
- `onExit` n'est **pas appelé** sur la scène du jeu
- `onEnter` **est appelé** sur la scène de pause
- La physique et la logique de mise à jour continuent pour la scène du jeu

Quand vous revenez de `pause` :
- `onExit` est appelé sur la scène de pause
- La scène du jeu **reprend immédiatement** (`onEnter` n'est pas appelé à nouveau)

## Validation

`defineSceneRouter()` valide au moment de la définition :
- `initial` doit être une clé dans `routes`
- Tous les cibles de transition doivent être des clés de route valides

Les erreurs sont levées immédiatement (pas au runtime), donc les routeurs mal configurés sont détectés pendant le développement.

## Exemple complet

```ts
// src/router.ts
import { defineSceneRouter } from '@gwenjs/core'
import { MenuScene } from './scenes/menu'
import { GameScene } from './scenes/game'
import { PauseScene } from './scenes/pause'
import { GameOverScene } from './scenes/game-over'

export const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: {
      scene: MenuScene,
      on: { START: 'game' },
    },
    game: {
      scene: GameScene,
      on: { PAUSE: 'pause', GAME_OVER: 'gameover' },
    },
    pause: {
      scene: PauseScene,
      overlay: true,
      on: { RESUME: 'game', QUIT: 'menu' },
    },
    gameover: {
      scene: GameOverScene,
      on: { RETRY: 'game', MENU: 'menu' },
    },
  },
})

// src/scenes/game.ts
import { defineScene } from '@gwenjs/core'
import { GameSystem } from '../systems'

export const GameScene = defineScene('Game', (registry) => ({
  systems: [GameSystem],
  
  onEnter: async () => {
    console.log('Game started')
    // Charger les ressources, réinitialiser le niveau, etc.
  },
  
  onExit: () => {
    console.log('Game exiting')
    // Nettoyage
  },
}))

// src/scenes/pause.ts
import { defineScene, useSceneRouter } from '@gwenjs/core'
import { PauseSystem } from '../systems'
import { AppRouter } from '../router'

export const PauseScene = defineScene('Pause', (registry) => ({
  systems: [PauseSystem],
  
  onEnter: async () => {
    console.log('Pause menu opened')
    // Mettre en pause la boucle de jeu (optionnel)
  },
  
  onExit: () => {
    console.log('Pause menu closed')
    // Reprendre la boucle de jeu (optionnel)
  },
}))

// src/main.ts
import { createEngine } from '@gwenjs/core'
import { AppRouter } from './router'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(AppRouter)
await engine.start()
```

## Résumé de l'API

| | |
|---|---|
| `defineSceneRouter(options)` | Déclarer la FSM |
| `useSceneRouter(router)` | Obtenir le handle au runtime à l'intérieur d'un acteur/système |
| `nav.send(event, params?)` | Déclencher une transition (async) |
| `nav.can(event)` | Vérifier si la transition est valide |
| `nav.current` | Nom d'état actuel |
| `nav.params` | Paramètres passés à l'état actuel |
| `nav.onTransition(fn)` | S'abonner aux changements d'état |

## Prochaines étapes

- **[Scènes](/fr/essentials/scenes)** — Détails de `defineScene` et du cycle de vie.
- **[Acteurs](/fr/essentials/actors)** — Naviguer depuis l'intérieur des acteurs en utilisant `useSceneRouter()`.
- **[Systèmes](/fr/essentials/systems)** — Naviguer depuis l'intérieur des systèmes.
