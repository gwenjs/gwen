---
title: Scenes
description: Group systems and actors into discrete game states — menus, gameplay, cutscenes — using defineScene().
---

# Scenes

A **scene** groups the active systems and actors for one game state. Swap scenes to change what runs — pause menu, gameplay, cutscene.

::: info Auto-imports
In a GWEN project, composables are available without any `import` statement — the framework generates global type declarations at build time. You write `defineScene(...)`, `useSystem(...)`, `onEnter(...)` directly, with no import.
:::

## The Basics

Use `defineScene()` to declare a scene. The factory body is a setup context — declare systems and actors via composables.

```ts
import { MovementSystem, RenderSystem } from './systems'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())
  useSystem(RenderSystem())
})
```

## Scene Lifecycle

Use `onEnter` and `onExit` to run code when the scene activates or deactivates:

```ts
export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())

  onEnter(() => {
    console.log('scene activated')
  })

  onExit(() => {
    console.log('scene deactivated')
  })
})
```

`onEnter` receives optional params passed by the router:

```ts
onEnter((params) => {
  const level = params?.level ?? 1
  console.log('Starting level', level)
})
```

::: tip Async onEnter and onExit
Async callbacks work seamlessly when `@gwenjs/vite` is configured. The Vite plugin propagates the engine context across `await`. See [Async Context](/advanced/async-context) for details.
:::

## Declaring Actors

Use `useActor(def)` in a scene to register an actor and get a handle for spawning:

```ts
import { PlayerActor } from './actors/player'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())

  const player = useActor(PlayerActor)

  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

`useActor()` returns an `ActorHandle`. See [Actors](/essentials/actors) for the full handle API.

## Declaring Prefabs

Use `usePrefab(def)` to register a prefab type for this scene:

```ts
const bullet = usePrefab(BulletPrefab)

onEnter(() => {
  bullet.spawn({ x: 100, y: 200 })
})
```

## Controlling Systems at Runtime

`useSystem()` returns a `SystemHandle` you can use to pause and resume systems during the scene:

```ts
const combat = useSystem(CombatSystem(player))

// During a cutscene:
combat.pause()

// After the cutscene:
combat.resume()
```

| | |
|---|---|
| `SystemHandle.pause()` | Stop frame callbacks, preserve state |
| `SystemHandle.resume()` | Restart callbacks |
| `SystemHandle.destroy()` | Permanently remove system |
| `SystemHandle.active` | `true` if system is running |

::: warning Manual pause and overlays
If a scene overlay pauses the underlying scene, systems are automatically scene-paused. A system you paused manually will not be auto-resumed when the overlay closes. Call `.resume()` explicitly.
:::

## Transition Animations

Use `onTransitionLeave` and `onTransitionEnter` to run animation logic around scene changes:

```ts
export const GameScene = defineScene('game', () => {
  onTransitionLeave(async ({ from, to }) => {
    // awaited before onExit — play leave animation here
    await fadeOut()
  })

  onTransitionEnter(async ({ from, to }) => {
    // awaited after onEnter — play enter animation here
    await fadeIn()
  })
})
```

- `onTransitionLeave` — called before `onExit`, receives `{ from, to }` state names
- `onTransitionEnter` — called after `onEnter`, receives `{ from, to }` state names

## Reading Router Params in a Scene

Use `useSceneRouter(router)` inside `onEnter` to read params passed during the transition:

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
| `usePrefab(def)` | Register prefab for this scene → `PrefabHandle` |
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
- **[Hooks](/essentials/hooks)** — React to scene lifecycle events from systems.
