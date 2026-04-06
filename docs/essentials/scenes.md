---
title: Scenes
description: Scenes organise your game into discrete, loadable states like menus, gameplay, and game over screens.
---

# Scenes

A **scene** is a collection of systems and actors that work together to create a distinct game state—your menu, main game, pause screen, game over screen, etc. Scenes are loaded and unloaded as a unit, making it easy to manage memory and organize complex games.

## The Basics

### Defining a Scene

Use `defineScene()` to create a scene with its systems and actors:

```ts
import { defineScene } from '@gwenjs/core'
import { MovementSystem, RenderSystem, CollisionSystem } from './systems'
import { PlayerActor } from './actors/player'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, RenderSystem, CollisionSystem],
  actors: [PlayerActor],
})
```

When `GameScene` is loaded:
1. All systems are initialized
2. All actors are spawned
3. The game loop runs every frame
4. When unloaded, all actors and systems are cleaned up

### Scene Router

Use `defineSceneRouter()` and `useSceneRouter()` to navigate between scenes:

```ts
import { defineSceneRouter, useSceneRouter } from '@gwenjs/core'
import { MenuScene, GameScene, GameOverScene } from './scenes'

export const router = defineSceneRouter({
  scenes: {
    menu: MenuScene,
    game: GameScene,
    gameover: GameOverScene,
  },
  initial: 'menu', // Scene loaded on startup
})
```

Inside a system, use `useSceneRouter()` to navigate:

```ts
import { defineSystem, useSceneRouter, onUpdate } from '@gwenjs/core'

export const MenuSystem = defineSystem(() => {
  const { push } = useSceneRouter()

  onUpdate(() => {
    if (playerPressedStart) {
      push('game') // Load GameScene
    }
  })
})
```

## Scene Lifecycle

Scenes follow this lifecycle:

```
Loading → onStart actors → Game Loop (onUpdate) → onBeforeDestroy actors → Unloading
```

- **Loading**: Systems and scene data are initialized
- **onStart**: Each actor's `onStart` callback fires once
- **Game Loop**: `onUpdate` runs every frame for systems and actors
- **onBeforeDestroy**: Each actor's `onBeforeDestroy` callback fires before the scene unloads
- **Unloading**: Memory is freed, systems stop

## In Practice

### Passing Data Between Scenes

Often you need to pass data when transitioning—like the player's final score to the game over screen:

```ts
// From GameScene, when the player dies:
const { push } = useSceneRouter()
const finalScore = calculateScore()
push('gameover', { score: finalScore, level: currentLevel })
```

In `GameOverScene`, access the data:

```ts
import { defineScene } from '@gwenjs/core'
import { GameOverUIActor } from './actors/gameOverUI'

export const GameOverScene = defineScene({
  name: 'gameover',
  actors: [GameOverUIActor],
})

// Inside GameOverUIActor:
export const GameOverUIActor = defineActor({
  name: 'GameOverUI',
  setup() {
    const { params } = useSceneRouter()
    console.log(params.score)  // number
    console.log(params.level)  // number
  },
})
```

### Multiple Scenes in a Game

A typical game uses 3-5 scenes:

```ts
export const router = defineSceneRouter({
  scenes: {
    menu: MenuScene,        // Main menu
    game: GameScene,        // Gameplay
    pause: PauseScene,      // Pause overlay
    gameover: GameOverScene, // Game over / final score
  },
  initial: 'menu',
})
```

Navigate between them based on game events:

```ts
// Menu → Game
push('game')

// Game → Pause
push('pause')

// Pause → Game
const { pop } = useSceneRouter()
pop() // Return to previous scene

// Game → GameOver
push('gameover', { score: 1500 })
```

### Scene Stack vs Navigation

`push()` adds a scene on top (useful for pause menus). `pop()` removes the top scene (returns to the previous one):

```ts
// Pause menu on top of gameplay
push('pause') // Now showing pause
pop()         // Back to game

// Game over replaces current scene
push('gameover') // Replaces game scene
```

## API Summary

| Function | Description |
|---|---|
| `defineScene(options)` | Declare a scene with systems and actors |
| `defineSceneRouter(options)` | Create a router managing multiple scenes |
| `useSceneRouter()` | Get router instance from a system or actor |
| `router.push(name, params?)` | Load a scene (add to stack) |
| `router.pop()` | Unload the current scene (return to previous) |

## Next Steps

- **[Layouts](/essentials/layouts)** — Persist UI across multiple scenes.
- **[Systems](/essentials/systems)** — Write game logic that runs in scenes.
- **[Actors](/essentials/scenes)** — Create unique named entities that live in scenes.
