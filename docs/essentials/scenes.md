---
title: Scenes
description: Group systems into discrete game states — menus, gameplay, cutscenes — using defineScene().
---

# Scenes

A **scene** groups the active systems for one game state. Swap scenes to change what systems run — pause menu, gameplay, cutscene.

## Defining a Scene

Use `defineScene()` to create a scene. Two forms are supported:

**Options form:**

```typescript
import { defineScene } from '@gwenjs/core/scene'
import { MovementSystem, RenderSystem } from './systems'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, RenderSystem],
})
```

**Factory form** — for inline queries, lifecycle hooks, and reactive setup:

```typescript
// imports omitted for brevity
export const GameScene = defineScene('game', () => {
  const entities = useQuery({ with: [Position, Velocity] })

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
    }
  })
})
```

To navigate between scenes, see [Scene Router](/essentials/scene-router).

## Next Steps

- **[Scene Router](/essentials/scene-router)** — Navigate between scenes with an FSM.
- **[Actors](/essentials/actors)** — Create named, instance-based entities within scenes.
- **[Systems](/essentials/systems)** — Write systems that run in scenes.
