---
title: Layouts
description: Persistent UI layers that survive scene transitions — perfect for HUDs, menu bars, and global UI.
---

# Layouts

A **layout** is a persistent layer that lives above all scenes. Unlike scenes (which load and unload), a layout persists across scene transitions. Use layouts for HUDs, menu bars, pause dialogs, and any UI that should survive when you change scenes.

::: info Auto-imports
In a GWEN project, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, and `placePrefab` are auto-imported — no `import` statement needed.
:::

## Defining a Layout

Use `defineLayout()` to declare a persistent layer. Inside the factory, place actors with `placeActor()`, passing their initial position and props:

```ts
import { HUDActor } from './actors/hud'
import { MinimapActor } from './actors/minimap'

export const GameLayout = defineLayout(() => {
  const hud     = placeActor(HUDActor,     { at: [0, 0] })
  const minimap = placeActor(MinimapActor, { at: [700, 16] })
  return { hud, minimap }
})
```

The object returned by the factory becomes `layout.refs` — a typed record of `PlaceHandle` values, one per placed actor.

## PlaceHandle

`placeActor()` returns a `PlaceHandle` with direct access to the placed entity:

| Property / Method | Description |
|---|---|
| `handle.api` | The actor's public API (return value of the actor factory) |
| `handle.entityId` | The entity's `bigint` ID |
| `handle.moveTo([x, y])` | Reposition the entity in world space |
| `handle.despawn()` | Despawn this entity immediately |

```ts
const layout = useLayout(GameLayout, { lazy: true })
await layout.load()

// Call a method on the HUD actor
layout.refs.hud.api.setScore(100)

// Move the minimap
layout.refs.minimap.moveTo([680, 16])
```

## Placement Options

All `place*` composables accept a second argument with placement options:

| Option | Type | Description |
|---|---|---|
| `at` | `[x, y]` | Local position. Default `[0, 0]` |
| `rotation` | `number` | Local rotation in radians. Default `0` |
| `scale` | `number \| [sx, sy]` | Uniform or per-axis scale. Default `1` |
| `parent` | `PlaceHandle` | Parent handle — position is relative to parent |
| `props` | `object` | Props forwarded to the actor at spawn time |

```ts
export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, {
    at: [0, 0],
    props: { initialScore: 0 },
  })

  // Anchor group — children inherit its transform
  const topBar = placeGroup({ at: [0, 0] })
  const timer  = placeActor(TimerActor, { at: [400, 8], parent: topBar })

  return { hud, topBar, timer }
})
```

## Progressive spawn with `chunkSize`

By default `load()` spawns every placed entity in one pass. A layout with many entities can make that frame slow. Pass `chunkSize` to spread the spawn over several frames:

```ts run
import assert from "node:assert/strict";
import { defineLayout, placeGroup, useLayout } from "@gwenjs/core/actor";

const Tiles = defineLayout(() => ({
  a: placeGroup({ at: [0, 0] }),
  b: placeGroup({ at: [1, 0] }),
  c: placeGroup({ at: [2, 0] }),
  d: placeGroup({ at: [3, 0] }),
  e: placeGroup({ at: [4, 0] }),
}));

const alive = () => engine.getStats().entityCount;
const base = alive();
const layout = await engine.run(() => useLayout(Tiles, { lazy: true, chunkSize: 2 }));

let loaded = false;
const loading = layout.load().then(() => {
  loaded = true;
});
assert.equal(alive() - base, 0);
assert.deepEqual(layout.refs, {});

await engine.advance(1 / 60);
assert.equal(alive() - base, 2);
await engine.advance(1 / 60);
assert.equal(alive() - base, 4);
await Promise.resolve();
assert.equal(loaded, false);

await engine.advance(1 / 60);
assert.equal(alive() - base, 5);
await loading;
assert.equal(loaded, true);
assert.deepEqual(Object.keys(layout.refs), ["a", "b", "c", "d", "e"]);

await layout.dispose();
```

Five entities with `chunkSize: 2` take three frames: two, then two, then one. In general a layout of `m` entities loads in `ceil(m / chunkSize)` frames.

How it works:

- `chunkSize` must be a positive integer. Otherwise `useLayout()` throws a `GwenComposableError` with code `COMPOSABLE:INVALID_CHUNK_SIZE`, and the message names the value.
- The factory runs once, when you call `load()`. Each `placeActor`, `placePrefab` and `placeGroup` call only records its spawn.
- The recorded spawns run in call order, at most `chunkSize` per frame, in the `engine:before-update` phase. The engine must advance for the load to finish.
- `load()` resolves when the last entity is alive. Until then `layout.refs` is `{}` and `layout.active` is `false`.
- A second `load()` while loading returns the same promise. It does not spawn twice.
- Without `chunkSize`, nothing changes: one pass, same entity order.

### Handles inside the factory

While the factory runs, no entity exists yet. Reading `entityId`, `api`, `moveTo` or `despawn` on a handle there throws a `GwenComposableError` with code `COMPOSABLE:LAYOUT_HANDLE_NOT_SPAWNED`.

You can still pass a handle as `parent`. The parent is read when the child spawns, and spawns run in call order. Place the parent first:

```ts
const GridLayout = defineLayout(() => {
  const grid = placeGroup({ at: [0, 0] })
  const tile = placeGroup({ at: [8, 8], parent: grid }) // grid spawns first
  return { grid, tile }
})
```

If a `parent` is placed after its child, the child's spawn throws the same error and `load()` rejects. See [When a spawn fails](#when-a-spawn-fails).

### Disposing or stopping while loading

`engine.stop()` during a progressive load does the same as `dispose()`, so `load()` never hangs and `engine.stop()` never rejects because of the layout. `dispose()` during a progressive load stops the remaining spawns and destroys the entities that already exist. This holds wherever `dispose()` is called from: between frames, from another `engine:before-update` hook in the same frame, or from inside a spawn (for example an actor setup). In that last case the entity being built is destroyed too. The pending `load()` promise resolves, `layout.refs` stays `{}` and `layout.active` stays `false`.

### When a spawn fails

If a `place*` call or the factory throws, the load stops, every entity the layout created is destroyed (including the one that was half built when the error was thrown), and `load()` rejects with that error. This holds with and without `chunkSize`. If destroying also fails, `load()` still rejects with the original error. After a failed load `layout.active` is `false`, `layout.refs` is `{}`, and a later `load()` runs the factory again.

With `lazy: false`, nothing awaits `load()`. A failure, chunked or not, is emitted on the engine error bus (`engine.errors`) with level `error`, code `COMPOSABLE:LAYOUT_LOAD_FAILED`, and the original error in `error`. Use `lazy: true` and await `load()` if you want to handle it yourself.

When nobody can receive the error of a cleanup, it goes to the error bus too, with code `COMPOSABLE:LAYOUT_DISPOSE_FAILED`. This happens when the cleanup runs in a frame hook (a `dispose()` from inside a spawn) or in `engine.stop()`. `engine.stop()` never rejects because of a layout.

## Layouts and Scene Lifecycle

The `defineScene` factory runs **once at bootstrap** — not on every scene navigation. `useLayout` called in the factory body creates the handle and captures it in a closure, but does not load the layout yet. `onEnter` and `onExit` run on every navigation and are where you load and dispose:

```ts
export const GameScene = defineScene('game', () => {
  // Factory runs ONCE at bootstrap — handle is captured, layout not loaded yet
  const layout = useLayout(GameLayout, { lazy: true })

  // Runs each time the scene activates
  onEnter(async () => await layout.load())

  // Runs each time the scene deactivates
  onExit(async () => await layout.dispose())
})
```

**Transition order** when navigating from scene A to scene B:

```
onTransitionLeave({ from: A, to: B })   ← play leave animation
onExit()                                 ← layout.dispose() — actors despawned
scene:leave
scene:enter
onEnter()                                ← layout.load() — actors spawned
onTransitionEnter({ from: A, to: B })   ← play enter animation
```

::: warning Always use `lazy: true` in scene factories
Without `{ lazy: true }`, `useLayout` calls `load()` immediately during the factory — at bootstrap, before any scene is active. Use `lazy: true` whenever the layout should load and unload with the scene lifecycle.
:::

`LayoutHandle` API:

| | |
|---|---|
| `layout.load()` | Activate — spawns all placed actors. Returns `Promise<void>`, resolved when every entity is alive |
| `layout.dispose()` | Deactivate — despawns all placed actors. Returns `Promise<void>` |
| `layout.active` | `true` if the layout is currently loaded |
| `layout.refs` | Typed record of `PlaceHandle` values. `{}` until `load()` resolves |

## Full Example — Game HUD

A HUD actor that updates score and health, placed in a layout that persists across scenes:

```ts
// src/actors/hud.ts
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'

export const HUDActor = defineActor(HUDPrefab, () => {
  const data = useComponent(HUDData)

  onUpdate(() => {
    renderHUD({ score: data.score, health: data.health })
  })

  return {
    setScore:  (n: number) => { data.score  = n },
    setHealth: (n: number) => { data.health = n },
  }
})

// src/layouts/game-layout.ts
import { HUDActor } from '../actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, { at: [0, 0] })
  return { hud }
})

// src/scenes/game-scene.ts
import { GameLayout } from '../layouts/game-layout'

export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout, { lazy: true })

  onEnter(async () => await layout.load())
  onExit(async ()  => await layout.dispose())
})

// Updating the HUD from another system — call via refs.api
layout.refs.hud.api.setScore(newScore)
```

## Layout vs Scene

| | Layout | Scene |
|---|---|---|
| **Persistence** | Survives scene transitions | Loads/unloads per scene |
| **Systems** | — | Run while the scene is active |
| **Actors** | Placed via `placeActor` | Registered via `useActor` |
| **Use case** | HUD, menu bars, global UI | Game states, level logic |

## API Summary

| | |
|---|---|
| `defineLayout(factory)` | Declare a persistent UI layer |
| `placeActor(def, options?)` | Place an actor — returns `PlaceHandle<API>` |
| `placeGroup(options?)` | Create a transform-only anchor entity — returns `PlaceHandle<void>` |
| `placePrefab(def, options?)` | Place a prefab entity — returns `PlaceHandle<void>` |
| `useLayout(def, options?)` | Get layout control handle (`{ lazy }` to defer load, `{ chunkSize }` to spawn progressively) |
| `layout.load()` | Activate the layout (`Promise<void>`) |
| `layout.dispose()` | Deactivate the layout (`Promise<void>`) |
| `layout.active` | `true` if layout is loaded |
| `layout.refs` | Typed record of placed handles |
| `handle.api` | Actor's public API |
| `handle.moveTo([x, y])` | Reposition the entity |
| `handle.despawn()` | Despawn this entity |

## Next Steps

- **[Scenes](/essentials/scenes)** — How scenes work alongside layouts.
- **[Actors](/essentials/actors)** — Build the UI actors placed in your layout.
- **[Prefabs](/essentials/prefabs)** — Define the component layout for your actors.
