---
title: Scenes
description: Organize your game into discrete, loadable states like menus, gameplay, and game over screens using scenes and a finite state machine router.
---

# Scenes

A **scene** is a named, loadable state in your game: your menu, main gameplay, pause screen, game over screen, etc. Scenes are defined with `defineScene()` and navigated with `defineSceneRouter()`.

## Defining a Scene

Use `defineScene()` to create a scene with systems and lifecycle hooks:

```ts
import { defineScene } from '@gwenjs/core'
import { MovementSystem, RenderSystem, CollisionSystem } from './systems'

// Option 1: Object form
export const GameScene = defineScene({
  name: 'Game',
  systems: [MovementSystem, RenderSystem, CollisionSystem],
})
```

Or use the **factory form** for dynamic setup and lifecycle hooks:

```ts
import { defineScene } from '@gwenjs/core'
import { MovementSystem, RenderSystem } from './systems'

// Option 2: Factory form (for onEnter/onExit)
export const GameScene = defineScene('Game', (registry) => ({
  systems: [MovementSystem, RenderSystem],
  
  onEnter: async () => {
    console.log('Game scene loaded!')
    // Load assets, initialize level, etc.
  },
  
  onExit: () => {
    console.log('Game scene unloading')
    // Cleanup
  },
}))
```

When a scene loads:
1. Systems are initialized
2. `onEnter()` callback runs (if defined)
3. Game loop runs each frame
4. When switching away, `onExit()` runs, then systems are cleaned up

## Scene Router — FSM Navigation

Use `defineSceneRouter()` to declare a **finite state machine (FSM)** for navigation:

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
      overlay: true,           // Render on top of game
      on: { RESUME: 'game', QUIT: 'menu' },
    },
    gameover: {
      scene: GameOverScene,
      on: { RETRY: 'game', MENU: 'menu' },
    },
  },
})
```

- `initial` — Starting state
- `routes` — Map of state name to route config
  - `scene` — The `defineScene()` object
  - `on` — Event→state transitions
  - `overlay: true` — Render on top (useful for pause menus)

## Navigation: useSceneRouter()

Inside a system or actor, call `useSceneRouter()` to get a navigation handle:

```ts
import { defineSystem, useSceneRouter, onUpdate } from '@gwenjs/core'
import { AppRouter } from '../router'

export const MenuSystem = defineSystem(() => {
  const nav = useSceneRouter(AppRouter)

  onUpdate(() => {
    if (playerPressedStart) {
      nav.send('PLAY')  // Transition to 'game'
    }
  })
})
```

Or inside an actor:

```ts
import { defineActor, useSceneRouter, onUpdate } from '@gwenjs/core'
import { AppRouter } from '../router'
import { useComponent } from '@gwenjs/core'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('DIE')  // Transition to 'gameover'
    }
  })

  return {}
})
```

## Router Handle API

```ts
const nav = useSceneRouter(AppRouter)

// Send an event
await nav.send('PLAY')

// Send with parameters
await nav.send('PLAY', { level: 2, difficulty: 'hard' })

// Check if transition is valid
if (nav.can('PLAY')) { /* ... */ }

// Get current state info
nav.current          // e.g., 'game'
nav.params           // Params passed to current state

// Subscribe to transitions
nav.onTransition((from, to) => {
  console.log(`Transitioning from ${from} to ${to}`)
})
```

## Passing Data Between Scenes

Pass params when transitioning:

```ts
// In game system, when player dies:
const nav = useSceneRouter(AppRouter)
const finalScore = calculateScore()
await nav.send('DIE', { score: finalScore, level: currentLevel })
```

In the target scene, access params via the router handle:

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

## Overlay Scenes (Pause Menus)

Set `overlay: true` to render a scene on top of the previous one:

```ts
const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
    pause: {
      scene: PauseScene,
      overlay: true,  // Keeps game rendering behind pause menu
      on: { RESUME: 'game', QUIT: 'menu' },
    },
  },
})
```

When you transition to `pause`:
- The game scene **stays loaded** (keeps running or paused)
- The pause scene **renders on top**
- Physics and systems in the game scene can be paused manually

## Scene Lifecycle

```
Router starts → Initial scene onEnter
         ↓
    Game loop runs (onUpdate)
         ↓
    Event triggered (e.g., PAUSE)
         ↓
    Current scene onExit
         ↓
    Target scene onEnter
         ↓
    Back to game loop
```

Example with pause menu:

```ts
// game: running, rendering, systems active
nav.send('PAUSE')
// game: onExit NOT called (overlay)
// pause: onEnter called
// game: still renders behind pause UI
// pause: renders on top

nav.send('RESUME')
// pause: onExit called
// game: still running (onEnter NOT called again)
// pause: removed from stack
```

## Complete Example

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

## API Summary

| Function | Description |
|---|---|
| `defineScene(name, factory)` | Create a scene with systems and lifecycle hooks |
| `defineSceneRouter(options)` | Declare the FSM (states, transitions) |
| `useSceneRouter(router)` | Get runtime handle inside system/actor |
| `nav.send(event, params?)` | Trigger a transition |
| `nav.can(event)` | Check if transition is valid in current state |
| `nav.current` | Get current state name |
| `nav.params` | Get params passed to current state |

## Next Steps

- **[Scene Router](/essentials/scene-router)** — Deep dive into navigation and FSM patterns.
- **[Actors](/essentials/actors)** — Create named, instance-based entities within scenes.
- **[Systems](/essentials/systems)** — Write systems that run in scenes.
