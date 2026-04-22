---
title: Scenes
description: Group systems and actors into discrete game states — menus, gameplay, cutscenes — using defineScene().
---

# Scenes

A **scene** groups the active systems and actors for one game state. Swap scenes to change what runs — pause menu, gameplay, cutscene.

::: info Auto-imports
In a GWEN project, composables are available without any `import` statement — the framework generates global type declarations at build time. You write `defineScene(...)`, `useSystem(...)`, `onEnter(...)` directly, with no import.
:::

## Setup vs Runtime

This is the most important concept in GWEN: the `defineScene` factory runs **once at bootstrap**, before any scene is active. Everything you write directly in the factory body is the *setup phase* — you declare what the scene owns.

`onEnter` and `onExit` are the *runtime phase* — they run on every navigation.

```ts
export const GameScene = defineScene('game', () => {

  // ── Setup phase (once at bootstrap) ──────────────────────────────
  const player = useActor(PlayerActor)        // register — does not spawn yet
  const move   = useSystem(MovementSystem())  // register — does not run yet

  // ── Runtime phase (on every navigation) ──────────────────────────
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))  // now it spawns
  onExit(() => player.despawnAll())                      // now it cleans up
})
```

The handles captured in setup (`player`, `move`) are available as closures in the runtime callbacks. This declare-then-use pattern is consistent across scenes, actors, systems, and layouts.

## Lifecycle Order

When navigating from scene **A** to scene **B**, callbacks fire in this order:

```
A: onTransitionLeave({ from: 'A', to: 'B' })   ← play leave animation, awaited
A: onExit()                                      ← despawn actors, dispose layouts
   scene:leave
   scene:enter
B: onEnter(params?)                              ← spawn actors, load layouts
B: onTransitionEnter({ from: 'A', to: 'B' })    ← play enter animation, awaited
```

## Declaring Actors

Use `useActor(def)` in the factory body to register an actor and get a spawn handle:

```ts
import { PlayerActor } from './actors/player'
import { EnemyActor }  from './actors/enemy'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())

  const player = useActor(PlayerActor)
  const enemy  = useActor(EnemyActor)

  onEnter(() => {
    player.spawnOnce({ x: 400, y: 530 })
    enemy.spawn({ x: 100, y: 100 })
    enemy.spawn({ x: 700, y: 100 })
  })

  onExit(() => {
    player.despawnAll()
    enemy.despawnAll()
  })
})
```

See [Actors](/essentials/actors) for the full `ActorHandle` API.

## Controlling Systems at Runtime

`useSystem()` returns a `SystemHandle` you can use to pause and resume systems during the scene:

```ts
export const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const combat = useSystem(CombatSystem(player))

  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())

  // During a cutscene — called from a hook or another system:
  // combat.pause()
  // combat.resume()
})
```

| | |
|---|---|
| `SystemHandle.pause()` | Stop frame callbacks, preserve state |
| `SystemHandle.resume()` | Restart callbacks |
| `SystemHandle.destroy()` | Permanently remove system |
| `SystemHandle.active` | `true` if system is running |

::: warning Manual pause and overlays
If a scene overlay pauses the underlying scene, systems are automatically scene-paused. A system you paused manually will not be auto-resumed when the overlay closes — call `.resume()` explicitly.
:::

## Transition Animations

Use `onTransitionLeave` and `onTransitionEnter` to play animations around scene changes. Both callbacks are awaited before the engine proceeds.

```ts
export const GameScene = defineScene('game', () => {
  onTransitionLeave(async ({ from, to }) => {
    await fadeOut(300)   // awaited before onExit
  })

  onTransitionEnter(async ({ from, to }) => {
    await fadeIn(300)    // awaited after onEnter
  })
})
```

## Reading Router Params

Use `useSceneRouter(router)` to read params passed by `nav.send()` during the transition:

```ts
import { AppRouter } from '../router'

export const GameScene = defineScene('game', () => {
  const nav = useSceneRouter(AppRouter)

  onEnter(() => {
    const { level } = nav.params
    console.log('Starting level', level)
  })
})
```

## API Summary

| | |
|---|---|
| `defineScene(name, factory)` | Declare a scene |
| `useSystem(plugin)` | Register a system → `SystemHandle` |
| `useActor(def)` | Register actor for this scene → `ActorHandle` |
| `onEnter(cb)` | Run when scene activates; receives optional params |
| `onExit(cb)` | Run when scene deactivates |
| `onTransitionLeave(cb)` | Before leave animation; receives `{ from, to }` |
| `onTransitionEnter(cb)` | After enter animation; receives `{ from, to }` |
| `useSceneRouter(router)` | Access scene router (e.g. to read `nav.params`) |
| `SystemHandle.pause()` | Pause system frame callbacks |
| `SystemHandle.resume()` | Resume system frame callbacks |
| `SystemHandle.destroy()` | Permanently remove system |
| `SystemHandle.active` | `true` if system is running |

## Next Steps

- **[Scene Router](/essentials/scene-router)** — Navigate between scenes with an FSM.
- **[Actors](/essentials/actors)** — Create named, instance-based entities within scenes.
- **[Layouts](/essentials/layouts)** — Persistent UI layers that survive scene transitions.
- **[Hooks](/essentials/hooks)** — React to scene lifecycle events from systems.
