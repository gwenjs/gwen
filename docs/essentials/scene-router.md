---
title: Scene Router
description: FSM-based scene navigation with typed transitions.
---

# Scene Router

The **scene router** orchestrates transitions between scenes using a finite state machine. Define states, transitions, and navigate programmatically.

> Scenes are defined separately with `defineScene()`. See [Scenes](/essentials/scenes).

## Defining a Router

`defineSceneRouter()` declares states and transitions:

```typescript
import { defineSceneRouter } from '@gwenjs/core'
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

- `initial` — the starting state (must be a key in `routes`)
- `on` — maps event names to target states
- `overlay: true` — the scene is rendered on top of the previous scene (useful for pause menus)

## Navigating

Call `useSceneRouter()` inside an actor or system to get a handle, then call `.send()` to trigger transitions:

```typescript
import { defineActor, useSceneRouter, onUpdate, useComponent } from '@gwenjs/core'
import { AppRouter } from '../router'
import { Health } from '../components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.value <= 0) {
      nav.send('GAME_OVER')     // transitions to 'gameOver'
    }
  })

  return {}
})
```

## Handle API

```typescript
const nav = useSceneRouter(AppRouter)

nav.send('START')     // trigger transition
nav.can('START')      // check if transition is valid
nav.current           // current state name
nav.params            // params passed on transition
```

## Passing Params

Pass data when sending an event:

```typescript
nav.send('START', { level: 2, difficulty: 'hard' })

// In the GameScene:
export const GameScene = defineScene('game', (registry) => ({
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

## Registering the Router

Register the router in `gwen.config.ts` as a module option:

```typescript
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/core', { router: AppRouter }],
  ],
})
```

The router is passed as a module option, not as a standalone `engine.use()` call.

## Complete Example

```typescript
// src/router.ts
import { defineSceneRouter } from '@gwenjs/core'
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

// gwen.config.ts
import { defineConfig } from '@gwenjs/core'
import { AppRouter } from './router'

export default defineConfig({
  modules: [
    ['@gwenjs/core', { router: AppRouter }],
  ],
})
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
