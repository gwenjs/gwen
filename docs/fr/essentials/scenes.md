---
title: Scènes
description: Organisez votre jeu en états discrets et chargeables comme les menus, le gameplay et les écrans de fin de partie à l'aide de scènes et d'un routeur à automate fini.
---

# Scènes

Une **scène** est un état nommé et chargeable de votre jeu : votre menu, le gameplay principal, l'écran de pause, l'écran de fin de partie, etc. Les scènes sont définies avec `defineScene()` et navigées avec `defineSceneRouter()`.

## Définir une scène

Utilisez `defineScene()` pour créer une scène avec des systèmes et des hooks de cycle de vie :

```ts
import { defineScene } from '@gwenjs/core'
import { MovementSystem, RenderSystem, CollisionSystem } from './systems'

// Option 1: Forme objet
export const GameScene = defineScene({
  name: 'Game',
  systems: [MovementSystem, RenderSystem, CollisionSystem],
})
```

Ou utilisez la **forme factory** pour la configuration dynamique et les hooks de cycle de vie :

```ts
import { defineScene } from '@gwenjs/core'
import { MovementSystem, RenderSystem } from './systems'

// Option 2: Forme factory (pour onEnter/onExit)
export const GameScene = defineScene('Game', (registry) => ({
  systems: [MovementSystem, RenderSystem],
  
  onEnter: async () => {
    console.log('Game scene loaded!')
    // Charger les assets, initialiser le niveau, etc.
  },
  
  onExit: () => {
    console.log('Game scene unloading')
    // Nettoyage
  },
}))
```

Lors du chargement d'une scène :
1. Les systèmes sont initialisés
2. Le callback `onEnter()` s'exécute (s'il est défini)
3. La boucle de jeu s'exécute à chaque image
4. Lors du passage à une autre scène, `onExit()` s'exécute, puis les systèmes sont nettoyés

## Routeur de scènes — Navigation FSM

Utilisez `defineSceneRouter()` pour déclarer une **machine à états finis (FSM)** pour la navigation :

```ts
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
      on: { PLAY: 'game' },
    },
    game: {
      scene: GameScene,
      on: { PAUSE: 'pause', DIE: 'gameover' },
    },
    pause: {
      scene: PauseScene,
      overlay: true,           // Afficher au-dessus du jeu
      on: { RESUME: 'game', QUIT: 'menu' },
    },
    gameover: {
      scene: GameOverScene,
      on: { RETRY: 'game', MENU: 'menu' },
    },
  },
})
```

- `initial` — État de départ
- `routes` — Carte du nom de l'état à la configuration de route
  - `scene` — L'objet `defineScene()`
  - `on` — Transitions événement→état
  - `overlay: true` — Afficher au-dessus (utile pour les menus de pause)

## Navigation : useSceneRouter()

À l'intérieur d'un système ou d'un acteur, appelez `useSceneRouter()` pour obtenir un handle de navigation :

```ts
import { defineSystem, useSceneRouter, onUpdate } from '@gwenjs/core'
import { AppRouter } from '../router'

export const MenuSystem = defineSystem(() => {
  const nav = useSceneRouter(AppRouter)

  onUpdate(() => {
    if (playerPressedStart) {
      nav.send('PLAY')  // Transitioner vers 'game'
    }
  })
})
```

Ou à l'intérieur d'un acteur :

```ts
import { defineActor, useSceneRouter, onUpdate } from '@gwenjs/core'
import { AppRouter } from '../router'
import { useComponent } from '@gwenjs/core'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('DIE')  // Transitioner vers 'gameover'
    }
  })

  return {}
})
```

## API du routeur

```ts
const nav = useSceneRouter(AppRouter)

// Envoyer un événement
await nav.send('PLAY')

// Envoyer avec des paramètres
await nav.send('PLAY', { level: 2, difficulty: 'hard' })

// Vérifier si la transition est valide
if (nav.can('PLAY')) { /* ... */ }

// Obtenir les informations de l'état actuel
nav.current          // p. ex., 'game'
nav.params           // Paramètres passés à l'état actuel

// S'abonner aux transitions
nav.onTransition((from, to) => {
  console.log(`Transitioning from ${from} to ${to}`)
})
```

## Passer des données entre les scènes

Passez des paramètres lors de la transition :

```ts
// Dans le système de jeu, lorsque le joueur meurt :
const nav = useSceneRouter(AppRouter)
const finalScore = calculateScore()
await nav.send('DIE', { score: finalScore, level: currentLevel })
```

Dans la scène cible, accédez aux paramètres via le handle du routeur :

```ts
export const GameOverScene = defineScene('GameOver', (registry) => {
  return {
    systems: [GameOverSystem],
    onEnter: async () => {
      const nav = useSceneRouter(AppRouter)
      console.log('Final score:', nav.params.score)
    },
  }
})
```

## Scènes de superposition (menus de pause)

Définissez `overlay: true` pour afficher une scène au-dessus de la précédente :

```ts
const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
    pause: {
      scene: PauseScene,
      overlay: true,  // Garde le jeu rendu derrière le menu de pause
      on: { RESUME: 'game', QUIT: 'menu' },
    },
  },
})
```

Lorsque vous passez à la scène `pause` :
- La scène de jeu **reste chargée** (continue de fonctionner ou est en pause)
- La scène de pause **s'affiche au-dessus**
- La physique et les systèmes dans la scène de jeu peuvent être mis en pause manuellement

## Cycle de vie de la scène

```
Le routeur démarre → onEnter de la scène initiale
          ↓
     La boucle de jeu s'exécute (onUpdate)
          ↓
     Un événement est déclenché (p. ex., PAUSE)
          ↓
     onExit de la scène actuelle
          ↓
     onEnter de la scène cible
          ↓
     Retour à la boucle de jeu
```

Exemple avec menu de pause :

```ts
// game: en cours d'exécution, rendu, systèmes actifs
nav.send('PAUSE')
// game: onExit N'EST PAS appelé (superposition)
// pause: onEnter appelé
// game: toujours rendu derrière l'interface de pause
// pause: rendu au-dessus

nav.send('RESUME')
// pause: onExit appelé
// game: toujours en cours d'exécution (onEnter N'EST PAS rappelé)
// pause: supprimé de la pile
```

## Exemple complet

```ts
// router.ts
import { defineSceneRouter } from '@gwenjs/core'
import { MenuScene } from './scenes/menu'
import { GameScene } from './scenes/game'
import { PauseScene } from './scenes/pause'

export const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: { START: 'game' } },
    game: { scene: GameScene, on: { PAUSE: 'pause', GAME_OVER: 'menu' } },
    pause: { scene: PauseScene, overlay: true, on: { RESUME: 'game', QUIT: 'menu' } },
  },
})

// main.ts
import { createEngine } from '@gwenjs/core'
import { AppRouter } from './router'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(AppRouter)
await engine.start()
```

## Résumé de l'API

| Fonction | Description |
|---|---|
| `defineScene(name, factory)` | Créer une scène avec des systèmes et des hooks de cycle de vie |
| `defineSceneRouter(options)` | Déclarer la FSM (états, transitions) |
| `useSceneRouter(router)` | Obtenir un handle d'exécution à l'intérieur d'un système/acteur |
| `nav.send(event, params?)` | Déclencher une transition |
| `nav.can(event)` | Vérifier si la transition est valide dans l'état actuel |
| `nav.current` | Obtenir le nom de l'état actuel |
| `nav.params` | Obtenir les paramètres passés à l'état actuel |

## Prochaines étapes

- **[Routeur de scènes](/essentials/scene-router)** — Approfondissement dans la navigation et les modèles FSM.
- **[Acteurs](/essentials/actors)** — Créer des entités nommées basées sur des instances au sein des scènes.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui s'exécutent dans les scènes.
