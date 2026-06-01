---
title: Scene Router
description: FSM-based scene navigation with typed transitions.
---

# Scene Router

The **scene router** orchestrates transitions between scenes using a finite state machine. Define states and transitions once; navigate programmatically from systems or scenes.

> Scenes are defined separately with `defineScene()`. See [Scenes](/essentials/scenes).

::: info Auto-imports
In a GWEN project, `defineSceneRouter` and `useSceneRouter` are auto-imported — no `import` statement needed for the composables themselves. Create your router object in `src/router.ts` and import **that object** wherever you call `useSceneRouter`:
```ts
import { AppRouter } from './router'  // import the router object, not the composable
```
:::

## The Basics

`defineSceneRouter()` declares states and transitions. All state targets are validated at definition time — errors throw immediately, not at runtime.

```ts
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

::: tip No registration needed
`defineSceneRouter` is standalone. Simply create it in `src/router.ts` and import wherever you need `useSceneRouter`. No `gwen.config.ts` entry required.
:::

## Navigating

Call `useSceneRouter(router)` inside a system or plugin to get the handle, then use `nav.send()` to trigger transitions.

**From a system (recommended):**

```ts
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

**From a local plugin (`src/plugins/`):**

When the system that needs to navigate lives inside a scene that is itself referenced by the router, importing `AppRouter` would create a circular import. Wire navigation in a local plugin instead — it sits outside the scene graph:

```ts
// src/plugins/navigation.ts
import { useSceneRouter } from '@gwenjs/core/scene'
import { useHook } from '@gwenjs/core'
import { AppRouter } from '../router'

export default () => ({
  name: 'app:navigation',
  setup() {
    const nav = useSceneRouter(AppRouter)
    useHook('nav:toGame', () => nav.send('START'))
  },
})
```

The scene just emits the event without knowing about the router:

```ts
// src/systems/TitleSystem.ts
export const TitleSystem = defineSystem(() => {
  const kb = useKeyboard()
  onUpdate(() => {
    if (kb.isPressed(Keys.Space)) emit('nav:toGame')
  })
})
```

::: warning Circular import pitfall
`router.ts` imports your scene files. If any scene (or anything it imports) also imports `router.ts`, you get a circular ES module dependency → `ReferenceError: Cannot access before initialization`.

**Rule:** scenes and their systems must never import `router.ts`. Put navigation wiring in `src/plugins/` or in systems that are not transitively imported by the router.
:::

**Reading params from a scene:**

```ts
export const GameScene = defineScene('game', () => {
  onEnter((params) => {
    const level = params?.level  // passed by nav.send('START', { level: 2 })
  })
})
```

## Handle API

| | |
|---|---|
| `nav.send(event, params?)` | Trigger a transition (async) |
| `nav.can(event)` | Check if transition is valid in current state |
| `nav.current` | Current state name |
| `nav.params` | Params passed to current state |
| `nav.onTransition(fn)` | Subscribe to state changes; returns unsubscribe fn |

## Passing Params

Pass data when triggering a transition. Read it in the target scene via `nav.params` or in `onEnter(params)`:

```ts
// Trigger with params
nav.send('START', { level: 2, difficulty: 'hard' })

// Read in target scene via onEnter callback
export const GameScene = defineScene('game', () => {
  onEnter((params) => {
    console.log('Level:', params?.level)
  })
})

// Or via nav.params
const nav = useSceneRouter(AppRouter)
onEnter(() => {
  const { level } = nav.params
})
```

## Overlay Scenes

Set `overlay: true` to keep the previous scene loaded and rendered behind the new one:

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

When you transition to `pause`:
- Game scene **stays loaded** (systems keep running)
- `onExit` is **not called** on the game scene
- `onEnter` **is called** on the pause scene

When returning from `pause`:
- `onExit` is called on the pause scene
- Game scene **resumes immediately** (`onEnter` not called again)

## Listening to Transitions

`nav.onTransition(fn)` subscribes to all state changes. It returns an unsubscribe function:

```ts
const unsubscribe = nav.onTransition((from, to, params) => {
  console.log(`Transitioned from ${from} to ${to}`)
})

// Later, to stop listening:
unsubscribe()
```

## Transition Animations

To play animations around scene changes, use `onTransitionLeave` and `onTransitionEnter` in the scene. See [Scenes — Transition Animations](/essentials/scenes#transition-animations).

## Validation

`defineSceneRouter()` validates at definition time:
- `initial` must be a key in `routes`
- All transition targets must be valid route keys

Errors are thrown immediately during development startup, not at runtime.

## API Summary

| | |
|---|---|
| `defineSceneRouter(options)` | Declare FSM with routes and initial state |
| `useSceneRouter(router)` | Get runtime handle (system or scene context) |
| `nav.send(event, params?)` | Trigger a transition (async) |
| `nav.can(event)` | Check if transition is valid |
| `nav.current` | Current state name |
| `nav.params` | Params passed to current state |
| `nav.onTransition(fn)` | Subscribe to state changes; returns unsubscribe fn |

## Next Steps

- **[Scenes](/essentials/scenes)** — Lifecycle and transition animation hooks.
- **[Systems](/essentials/systems)** — Navigate from inside systems.
- **[Hooks](/essentials/hooks)** — React to `scene:enter` and `scene:leave` events.
