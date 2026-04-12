---
title: Scenes
description: Group systems into discrete game states — menus, gameplay, cutscenes — using defineScene().
---

# Scenes

A **scene** groups the active systems for one game state. Swap scenes to change what systems run — pause menu, gameplay, cutscene.

## Defining a Scene

Use `defineScene()` to create a scene. The factory body is a setup context: declare systems and lifecycle hooks via composables.

```typescript
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { useActor } from '@gwenjs/core/actor'
import { MovementSystem, RenderSystem } from './systems'
import { PlayerActor } from './actors/player'

export const GameScene = defineScene('game', () => {
    useSystem(MovementSystem())
    useSystem(RenderSystem())

  const player = useActor(PlayerActor)
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

## Scene Composables

| Composable | When to use |
|---|---|
| `useSystem([...])` | Declare which systems run while this scene is active |
| `onEnter(cb)` | Spawn actors, load resources, start music when the scene activates |
| `onExit(cb)` | Despawn actors, release resources when leaving the scene |

The factory runs inside an active engine context, so `useEngine()`, `useActor()`, `usePrefab()`, and `useSceneRouter()` are all available.

## Minimal Scene

A scene with no actors and no lifecycle hooks:

```typescript
import { defineScene, useSystem } from '@gwenjs/core/scene'
import { MovementSystem, RenderSystem } from './systems'

export const GameScene = defineScene('game', () => {
    useSystem(MovementSystem())
    useSystem(RenderSystem())
})
```

To navigate between scenes, see [Scene Router](/essentials/scene-router).

## Next Steps

- **[Scene Router](/essentials/scene-router)** — Navigate between scenes with an FSM.
- **[Actors](/essentials/actors)** — Create named, instance-based entities within scenes.
- **[Systems](/essentials/systems)** — Write systems that run in scenes.
