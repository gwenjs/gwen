---
title: Systems
description: Systems are where all game logic lives in GWEN. Learn to define them, query entities, and use all system-context composables.
---

# Systems

A **system** is a function that runs every frame and reads/writes component data. Systems are the game logic layer of GWEN's ECS.

::: info Auto-imports
In a GWEN project, composables are available without any `import` statement — the framework generates global type declarations at build time. You write `defineSystem(...)`, `useQuery(...)`, `onUpdate(...)` directly, with no import.

One exception requires an explicit import:
```ts
import { useHook, emit } from '@gwenjs/core'  // event system
```
:::

## Setup vs Runtime

The `defineSystem` factory body runs **once** when the system is installed — this is the *setup phase*. Frame callbacks (`onUpdate`, etc.) run every frame — this is the *runtime phase*.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { x: Types.f32, y: Types.f32 },
});

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      const vel = chunk.get(Velocity);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (vel.x[row] ?? 0) * dt;
      }
    }
  });
});
```

`defineSystem()` returns a **factory function** — call it to produce a plugin, then pass that to `useSystem()` inside a scene:

```ts
// In a scene:
useSystem(MovementSystem())
```

## Querying Entities

`useQuery()` returns a `Query` of the entities that have every listed component. The rows change as entities gain or lose those components.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { x: Types.f32, y: Types.f32 },
});

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      const vel = chunk.get(Velocity);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (vel.x[row] ?? 0) * dt;
        pos.y[row] = (pos.y[row] ?? 0) + (vel.y[row] ?? 0) * dt;
      }
    }
  });
});
```

`chunk.entityId(row)` is the `bigint` id of that row. `query.each()` and `entity.get(Def)` are the per-entity path. `entity.get` returns a snapshot.

A write in one system's chunk loop is visible to a later system in the same frame:

```ts run
import assert from "node:assert/strict";
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsStorageSystemsPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const id = engine.createEntity();
engine.addComponent(id, Position, { x: 1, y: 0 });

await engine.use(
  defineSystem("docs-storage-writer", () => {
    const query = useQuery([Position]);
    onUpdate(() => {
      for (const chunk of query) {
        const pos = chunk.get(Position);
        for (let row = 0; row < chunk.count; row += 1) pos.x[row] = 7;
      }
    });
  })(),
);

let readBack = 0;
await engine.use(
  defineSystem("docs-storage-reader", () => {
    const query = useQuery([Position]);
    onUpdate(() => {
      for (const chunk of query) {
        const pos = chunk.get(Position);
        readBack = pos.x[0] ?? 0;
      }
    });
  })(),
);

await engine.startExternal();
await engine.advance(0.016);
assert.equal(readBack, 7);
```

## Reading one entity

The chunk loop is the default. `query.each()` and `useComponentFor` read one entity. During an update phase they log code `CORE:QUERY_PER_ENTITY_PATH`. Deprecated: `useComponentFor` and `createLiveQuery`.

## Frame Phases

Register callbacks in the correct phase for your use case:

| Composable | Phase | Typical use |
|---|---|---|
| `onBeforeUpdate(fn)` | Before physics/WASM | Input sampling, pre-simulation |
| `onUpdate(fn)` | Main update | Game logic, AI, movement |
| `onAfterUpdate(fn)` | Post-update | State sync, scoring |
| `onRender(fn)` | Render | Draw calls. Receives the interpolation factor `alpha`, not a delta time |

```ts
export const InputSystem = defineSystem(() => {
  onBeforeUpdate((dt) => { /* read input */ })
  onUpdate((dt)       => { /* apply movement */ })
  onAfterUpdate((dt)  => { /* update debug HUD */ })
  onRender(()         => { /* draw debug overlay */ })
})
```

## Dependency Injection

Systems declare typed dependencies as parameters. The scene wires them at setup time, keeping the system decoupled from concrete implementations.

```ts
export const CombatSystem = defineSystem((target: { takeDamage(n: number): void }) => {
  onUpdate(() => target.takeDamage(5))
})
```

In the scene, pass the concrete value:

```ts
const player = useActor(PlayerActor)
useSystem(CombatSystem(player))  // player satisfies the interface
```

## Accessing Services

Use `useService(key)` to access a value provided by a plugin. Resolved once at setup time, used as a closure in callbacks.

```ts
export const AudioSystem = defineSystem(() => {
  const audio = useService('audio')  // provided by an audio plugin

  onUpdate(() => {
    // use audio service
  })
})
```

## Listening to Events

Use `useHook()` to subscribe to an engine or game event. The subscription is automatically removed when the scene exits.

```ts
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(() => {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
  })

  useHook('player:scored', (points: number) => {
    score += points
  })
})
```

::: info Explicit import required
`useHook` and `emit` are not auto-imported — always import them from `@gwenjs/core`.
:::

## Using Actors in a System

Use `useActor(def)` inside a system body to get a handle for spawning and despawning actor instances. GWEN auto-discovers and installs the actor plugin — no separate scene declaration needed.

```ts
import { AsteroidActor } from './actors/asteroid'

export const SpawnSystem = defineSystem(() => {
  const asteroid = useActor(AsteroidActor)

  onUpdate((dt) => {
    if (shouldSpawn) {
      asteroid.spawn({ x: randomX(), y: -10 })
    }
  })
})
```

## Navigating Between Scenes

Use `useSceneRouter(router)` to access the scene router from a system. Call `nav.send()` to trigger transitions.

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

## System Naming

The engine uses a name for deduplication and debugging. With `gwenVitePlugin`, the name is **injected automatically** from the exported variable name. Without the Vite plugin (tests, Node.js), pass it explicitly:

```ts
// ✅ With Vite plugin — name inferred from export const
export const MovementSystem = defineSystem(() => { ... })

// ✅ Without Vite plugin — explicit name
export const MovementSystem = defineSystem('MovementSystem', () => { ... })
```

## SystemHandle — Lifecycle Control

`useSystem()` returns a `SystemHandle`:

```ts
const combat = useSystem(CombatSystem(player))

combat.pause()            // stop frame callbacks, preserve state
combat.resume()           // restart callbacks
combat.destroy()          // permanently remove from frame loop
combat.active             // boolean — true if running
```

::: warning Manual pause vs scene overlay
If a scene overlay (e.g. a pause menu) freezes the underlying scene, systems are automatically scene-paused by the engine. A system you paused yourself **will not** be reactivated when the overlay closes — only the engine's scene-pause is cleared. Call `combat.resume()` explicitly when your cutscene ends.
:::

## API Summary

| | |
|---|---|
| `defineSystem(factory)` | Declare a system |
| `useQuery([...defs])` | Chunk query for entities that have every component |
| `chunk.get(Def).field[row]` | Live column for one row |
| `chunk.entityId(row)` | Entity id (`bigint`) at that row |
| `entity.get(def)` | Per-entity snapshot from `query.each()` |
| `onBeforeUpdate(fn)` | Before-update frame callback |
| `onUpdate(fn)` | Main update frame callback |
| `onAfterUpdate(fn)` | After-update frame callback |
| `onRender(fn)` | Render frame callback |
| `useService(key)` | Access a service provided by a plugin |
| `useHook(name, fn)` | Subscribe to an event — `import { useHook } from '@gwenjs/core'` |
| `useActor(def)` | Spawn/despawn actor instances |
| `useSceneRouter(router)` | Access scene router handle |
| `SystemHandle.pause()` | Pause frame callbacks |
| `SystemHandle.resume()` | Resume frame callbacks |
| `SystemHandle.destroy()` | Permanently remove system |
| `SystemHandle.active` | `true` if system is running |

## Next Steps

- **[Actors](/essentials/actors)** — Per-instance game objects with their own lifecycle.
- **[Scenes](/essentials/scenes)** — Register systems and control them at runtime.
- **[Hooks](/essentials/hooks)** — Define and use typed custom events.
