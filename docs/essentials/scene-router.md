---
title: Scene Router
description: FSM-based scene navigation with typed transitions.
---

# Scene Router

GWEN's scene router is a **finite state machine (FSM)**: you declare scenes as named states and define which events trigger transitions between them. This makes navigation type-safe and predictable.

## Defining a Router

`defineSceneRouter()` declares states and transitions:

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

- `initial` — the starting state (must be a key in `routes`)
- `on` — maps event names to target states
- `overlay: true` — the scene is rendered on top of the previous scene (useful for pause menus)

## Navigating

Call `useSceneRouter()` inside an actor or system to get a handle, then call `.send()` to trigger transitions:

```ts
import { defineActor, useSceneRouter, onUpdate, useComponent } from '@gwenjs/core'
import { AppRouter } from '../router'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('DIE')           // transitions to 'gameover'
    }
  })

  return {}
})
```

## Handle API

```ts
const nav = useSceneRouter(AppRouter)

nav.current          // current state name, e.g. 'game'
nav.params           // params passed to the current state
await nav.send('EVENT')    // trigger a transition (async, returns Promise<void>)
nav.can('EVENT')     // check if the event is valid in the current state
nav.onTransition(fn) // subscribe to all transitions
```

## Passing Params

Pass data when sending an event:

```ts
nav.send('PLAY', { level: 2, difficulty: 'hard' })

// In the GameScene:
export const GameScene = defineScene('Game', (registry) => ({
  systems: [GameSystem],
  onEnter: async () => {
    const nav = useSceneRouter(AppRouter)
    const params = nav.params
    console.log('Starting level', params.level)
  },
}))
```

## Scene Lifecycle

When a transition fires:
1. `onExit` of the current scene is called (unless `overlay: true`)
2. `onEnter` of the target scene is called
3. Systems from the old scene are deregistered, new ones registered

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

## Overlay Scenes

Set `overlay: true` to keep the previous scene loaded and rendered behind the new one:

```ts
const AppRouter = defineSceneRouter({
  initial: 'game',
  routes: {
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
    pause: {
      scene: PauseScene,
      overlay: true,  // Game keeps running behind pause menu
      on: { RESUME: 'game' },
    },
  },
})
```

When you transition to `pause`:
- Game scene **stays loaded** (systems keep running)
- Game scene **stays rendering** (behind pause UI)
- `onExit` is **not called** on the game scene
- `onEnter` **is called** on the pause scene
- Physics and update logic continue for the game scene

When you return from `pause`:
- `onExit` is called on pause scene
- Game scene **resumes immediately** (`onEnter` is not called again)

## Validation

`defineSceneRouter()` validates at definition time:
- `initial` must be a key in `routes`
- All transition targets must be valid route keys

Errors are thrown immediately (not at runtime), so misconfigured routers are caught during development.

## Complete Example

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
    // Load assets, reset level, etc.
  },
  
  onExit: () => {
    console.log('Game exiting')
    // Cleanup
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
    // Pause the game loop (optional)
  },
  
  onExit: () => {
    console.log('Pause menu closed')
    // Resume game loop (optional)
  },
}))

// src/main.ts
import { createEngine } from '@gwenjs/core'
import { AppRouter } from './router'

const engine = await createEngine({ variant: 'physics2d' })
await engine.use(AppRouter)
await engine.start()
```

## API Summary

| | |
|---|---|
| `defineSceneRouter(options)` | Declare the FSM |
| `useSceneRouter(router)` | Get runtime handle inside actor/system |
| `nav.send(event, params?)` | Trigger a transition (async) |
| `nav.can(event)` | Check if transition is valid |
| `nav.current` | Current state name |
| `nav.params` | Params passed to current state |
| `nav.onTransition(fn)` | Subscribe to state changes |

## Next Steps

- **[Scenes](/essentials/scenes)** — `defineScene` and lifecycle details.
- **[Actors](/essentials/actors)** — Navigate from inside actors using `useSceneRouter()`.
- **[Systems](/essentials/systems)** — Navigate from inside systems.
