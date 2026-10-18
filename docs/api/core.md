---
title: "@gwenjs/core"
description: "API reference for @gwenjs/core."
---

# @gwenjs/core API Reference

`pnpm add @gwenjs/core`

## `@gwenjs/core` — Engine

The flat import. Engine bootstrap, shared types, WASM utilities, tween.

**Key exports:** `createEngine`, `useEngine`, `GwenContextError`, `GwenPlugin` (type), `GwenEngine` (type), `GwenProvides` (type), `GwenRuntimeHooks` (type), `createLogger`, `setupGwen`, tween utilities.

**Usage:**
```ts
import { createEngine, useEngine, createLogger } from '@gwenjs/core'
import { useTween } from '@gwenjs/core'
```

### Engine

### setupGwen(options)

**Signature:**
```ts
function setupGwen(options?: GwenEngineOptions): Promise<GwenEngine>
```

**Description.** Loads the WASM core and creates the engine. This is the entry point for an application. `createEngine()` loads the light WASM bridge when no `_bridge` is given. `engine.start()` returns a promise. It throws `CORE:WASM_NOT_INITIALIZED` when that bridge is not active.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `GwenEngineOptions` | Engine configuration (variant, maxEntities, debug). |

**Returns:** `Promise<GwenEngine>` — the engine, with WASM loaded.

**Example:**
```ts
import { setupGwen } from '@gwenjs/core'

const engine = await setupGwen({
  maxEntities: 10_000,
  variant: 'physics2d',
  debug: true,
})
await engine.start()
```

### useEngine()

**Signature:**
```ts
function useEngine(): GwenEngine
```

**Description.** Returns the current engine instance inside a system setup or composable. Must be called during system initialization.

**Returns:** `GwenEngine` — the active engine.

**Example:**
```ts
const MySystem = defineSystem('MySystem', () => {
  const engine = useEngine()
  console.log(engine.deltaTime)
})
```

### engine.timeScale

**Type:** `number` — mutable, default `1`.

Global time multiplier applied to every frame's delta time before it reaches systems and actors.

| Value | Effect |
|---|---|
| `1` | Normal speed (default) |
| `0` | The step `dt` is `0`. The state does not change. |
| `0.5` | Half speed (slow motion) |
| `2` | Double speed |

Clamped to `[0, 100]` at runtime. Applied after the `maxDeltaSeconds` safety cap — time dilation never causes physics instability.

```ts
// The step dt becomes 0. The state does not change.
engine.timeScale = 0

// Bullet time
engine.timeScale = 0.2

// SimCity fast-forward
engine.timeScale = 4

// Normal speed
engine.timeScale = 1
```

::: tip Step dt
`engine.timeScale` scales the step `dt` only. There is no `pause()` and no `paused` state. `timeScale` of `0` makes the step `dt` `0`. The state does not change.
:::

### useTween(options)

**Signature:**
```ts
function useTween<T>(options: {
  duration: number
  easing?: string
  loop?: boolean
  yoyo?: boolean
}): TweenHandle<T> | null
```

**Description.** Creates an animation tween. Returns a handle with methods to play, pause, reset, queue follow-ups, and register completion callbacks. Returns `null` when the pool policy is `drop` and the pool is exhausted. The default policy grows the pool instead.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.duration | `number` | Duration in seconds |
| options.easing | `string` | Easing function name (optional) |
| options.loop | `boolean` | Loop animation (optional) |
| options.yoyo | `boolean` | Reverse animation on loop (optional) |

**Returns:** `TweenHandle<T> | null` — tween controller with methods: `.play({ from, to })`, `.pause()`, `.reset()`, `.to({ value, duration })`, `.onComplete(cb)`, `.onLoop(cb)`, and properties: `.value`, `.playing`. `null` when a `drop` pool is exhausted.

**Example:**
```ts
const opacity = useTween<number>({ duration: 0.5, easing: 'easeInOut' })

onUpdate(() => {
  if (!opacity.playing) {
    opacity.play({ from: 0, to: 1 })
  }
  mesh.material.opacity = opacity.value
})
```

## `@gwenjs/core/system`

System definition and frame-loop composables.

**Exports:** `defineSystem`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `useQuery`, `useService`, `useWasmModule`

**Usage:**
```ts
import { defineSystem, onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from '@gwenjs/core/system'
import { useQuery, useService, useWasmModule } from '@gwenjs/core/system'
```

### Systems

#### defineSystem(setup)

**Signature:**
```ts
function defineSystem(setup: () => void): GwenPlugin
```

**Description.** Defines a system that runs once during initialization. Use lifecycle hooks and queries inside setup.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| setup | `function` | Setup function called once at initialization |

**Returns:** `GwenPlugin` — plugin for scene registration.

**Example:**
```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsApiMovePos",
  schema: { x: Types.f32, y: Types.f32 },
});
const Velocity = defineComponent({
  name: "DocsApiMoveVel",
  schema: { x: Types.f32, y: Types.f32 },
});

export const moveSystem = defineSystem(() => {
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

#### useQuery(components)

**Signature:**
```ts
function useQuery<const C extends readonly ComponentDef[]>(components: C): Query<C>
```

**Description.** Creates a query that iterates chunks of entities with the specified components. A structural change made inside an open chunk loop (create, destroy, add, remove, or a dormancy toggle) applies when the outermost loop closes. Field writes, and an in-place add of a component the entity already has, apply at once. `each()` stays immediate and iterates one accessor per matching entity.

Iteration skips dormant pooled entities (released by an actor pool and not yet acquired again). Their components stay attached.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| components | `ComponentDef[]` | Components to query for |

**Returns:** `Query` — an iterable of chunks. `each()` returns the matching entities.

**Example:**
```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsApiEnemyPos",
  schema: { x: Types.f32, y: Types.f32 },
});
const EnemyTag = defineComponent({
  name: "DocsApiEnemyTag",
  schema: { tag: Types.u32 },
});

export const NudgeEnemies = defineSystem(() => {
  const enemies = useQuery([Position, EnemyTag]);

  onUpdate(() => {
    for (const chunk of enemies) {
      const pos = chunk.get(Position);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + 1;
      }
    }
  });
});
```

#### useService(name)

**Signature:**
```ts
function useService<K extends keyof GwenProvides>(key: K): GwenProvides[K]
```

**Description.** Returns a service registered by a plugin.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | Service name |

**Returns:** `any` — the service instance.

**Example:**
```ts
const physics = useService('physics');
```

#### useWasmModule(name)

**Signature:**
```ts
function useWasmModule<K extends keyof GwenWasmModules>(name: K): WasmModuleHandle<GwenWasmModules[K]>
```

**Description.** Returns a WASM module loaded by a plugin.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | WASM module name |

**Returns:** `any` — the WASM module handle.

## `@gwenjs/core/actor`

Actor definition, instance lifecycle, and all actor composables.

**Exports:** `defineActor`, `onStart`, `onDestroy`, `onEnable`, `onDisable`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `definePrefab`, `useActor`, `useComponent`, `usePrefab`, `useEntityId`, `useTransform`, `useChildren`, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab`, `defineActorPool`, `useActorPool`

**Usage:**
```ts
import {
  defineActor,
  onStart,
  onDestroy,
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
} from '@gwenjs/core/actor'
import { definePrefab, useActor, useComponent, usePrefab } from '@gwenjs/core/actor'
import { useTransform, defineLayout, useLayout, placeActor, placeGroup, placePrefab } from '@gwenjs/core/actor'
```

### Actors

#### defineActor(prefab, factory)

**Signature:**
```ts
function defineActor<Props = void>(
  prefab: PrefabDefinition,
  factory: (props?: Props) => Record<string, unknown>
): ActorDef
```

**Description.** Defines an actor — an entity template with lifecycle hooks and a public API. The `factory` runs once per spawned instance; register lifecycle hooks (`onStart`, `onUpdate`, `onDestroy`) inside it. The returned object becomes the actor's public API.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| `prefab` | `PrefabDefinition` | Component set and defaults, defined with `definePrefab()` |
| `factory` | `(props?) => object` | Runs once per spawn — register lifecycle hooks here, return public API |

**Returns:** `ActorDef` — use `ActorDef._plugin` to spawn and despawn instances.

**Example:**
```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab, onDestroy, onStart, useActor, useComponent } from "@gwenjs/core/actor";
import { defineSystem } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsApiActorPos",
  schema: { x: Types.f32, y: Types.f32 },
});
const Health = defineComponent({
  name: "DocsApiActorHealth",
  schema: { hp: Types.f32 },
});

const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { hp: 100 } },
]);

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  const health = useComponent(Health);
  onStart(() => {
    health.hp = props.hp;
  });
  onDestroy(() => {
    console.log("Enemy destroyed");
  });
  return {
    takeDamage: (n: number) => {
      health.hp -= n;
    },
  };
});

export const SpawnSystem = defineSystem(() => {
  const enemies = useActor(EnemyActor);
  const id = enemies.spawn({ hp: 50 });
  enemies.despawn(id);
});
```

Register the actor with `engine.use(EnemyActor._plugin)` before the scene runs. `spawn()` inside a `defineScene()` factory throws `ACTOR:PLUGIN_NOT_READY`. The system above is the call that type-checks.

#### useActor(ActorDef)

**Signature:**
```ts
function useActor<Props, PublicAPI>(def: ActorDefinition<Props, PublicAPI>): ActorHandle<Props, PublicAPI>
```

**Description.** Returns a typed handle for spawning, despawning, and accessing instances of an actor. Must be called during the setup phase of a system or actor (not inside lifecycle callbacks).

**Returns:** `ActorHandle` — object with `spawn`, `despawn`, `despawnAll`, `count`, `get`, `getAll`, `spawnOnce`. Implements `Iterable<PublicAPI>` — supports `for...of` directly.

#### useActorQuery(def, query)

**Signature:**
```ts
function useActorQuery<P, A>(
  def: ActorDefinition<P, A>,
  query: Iterable<{ readonly id: EntityId }>,
): Iterable<A>
```

**Description.** Returns a lazy iterable over the public APIs of actor instances whose underlying entity is present in `query`. Re-evaluated on every `for...of` — reflects the live ECS state at iteration time. No intermediate array is allocated.

Pair with `useQuery` from `@gwenjs/core/system` to filter by component:

```ts
defineSystem(() => {
  const inRange = useQuery([InRangeTag])
  const nearby = useActorQuery(EnemyActor, inRange.each())

  onUpdate(() => {
    for (const enemy of nearby) {
      enemy.takeDamage(10)
    }
  })
})
```

**Parameters:**
| Param | Type | Description |
|---|---|---|
| `def` | `ActorDefinition<P, A>` | Actor definition produced by `defineActor` |
| `query` | `Iterable<{ readonly id: EntityId }>` | Any iterable exposing entity IDs — typically `query.each()` from `useQuery` |

**Returns:** `Iterable<A>` — lazy. Entities in `query` with no live actor instance are silently skipped.

::: tip Why does it accept a query instead of component definitions?
`useActorQuery` lives in `@gwenjs/core/actor` and does not depend on the system layer. Accepting `query.each()` keeps the two layers decoupled and makes the function composable with any iterable that exposes an `id`.
:::

#### useComponent(ComponentDef)

**Signature:**
```ts
function useComponent<D extends ComponentDef>(def: D): InferComponent<D> & { $set(patch: Partial<InferComponent<D>>): void }
```

**Description.** Returns a live proxy over the current actor's component data. Field reads and writes are forwarded directly to the ECS. Must be called during the setup phase.

**Returns:** `T` — proxy object exposing component fields directly (e.g. `health.hp`, not `health.value.hp`).

**Example:**
```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)
  onStart(() => {
    console.log('hp:', health.hp)
  })
})
```

#### usePrefab(PrefabDef)

**Signature:**
```ts
function usePrefab(def: PrefabDef): () => Entity
```

**Description.** Returns a spawn function for a prefab.

**Returns:** `() => Entity` — function to spawn the prefab.

**Example:**
```ts
const spawnBullet = usePrefab(BulletPrefab);
const bullet = spawnBullet();
```

#### placeActor(def, overrides?)

**Signature:**
```ts
function placeActor(def: ActorDef, overrides?: Record<string, any>): Entity
```

**Description.** Immediately spawns an actor in the current scene.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| def | `ActorDef` | Actor definition |
| overrides | `object` | Component property overrides |

**Returns:** `Entity` — the spawned entity.

**Example:**
```ts
const enemy = placeActor(Enemy, { health: { hp: 50 } });
```

#### placePrefab(def, overrides?)

**Signature:**
```ts
function placePrefab(def: PrefabDef, overrides?: Record<string, any>): Entity
```

**Description.** Immediately spawns a prefab in the current scene.

**Returns:** `Entity` — the spawned entity.

#### placeGroup(actors)

**Signature:**
```ts
function placeGroup(actors: (ActorDef | () => ActorDef)[]): Entity[]
```

**Description.** Spawns multiple actors at once.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| actors | `array` | Array of actor definitions or factories |

**Returns:** `Entity[]` — array of spawned entities.

### Prefabs

#### definePrefab(entries)

**Signature:**
```ts
function definePrefab(entries: Array<{ def: ComponentDef; defaults: Record<string, any> }>): PrefabDef
```

**Description.** Defines a reusable entity template (prefab) with predefined components and default values.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| entries | `Array<{ def, defaults }>` | List of components with their default values |

**Returns:** `PrefabDef` — prefab definition.

**Example:**
```ts
const BulletPrefab = definePrefab([
  { def: Transform, defaults: { x: 0, y: 0 } },
  { def: Velocity,  defaults: { x: 0, y: 0 } },
])
```

### Lifecycle Hooks

#### onStart(cb)

**Signature:**
```ts
function onStart(cb: () => void): void
```

**Description.** Registers a callback to run when the engine starts or a scene is entered.

**Returns:** `void`

#### onDestroy(cb)

**Signature:**
```ts
function onDestroy(cb: () => void): void
```

**Description.** Registers a callback to run when the engine stops or a scene is exited.

**Returns:** `void`

#### onUpdate(cb)

**Signature:**
```ts
function onUpdate(cb: (deltaTime: number) => void): void
```

**Description.** Registers a callback to run every frame during the update phase.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| cb | `function` | Callback receiving deltaTime in seconds |

**Returns:** `void`

**Example:**
```ts
onUpdate((dt) => {
  console.log('Frame time:', dt);
});
```

#### onBeforeUpdate(cb)

**Signature:**
```ts
function onBeforeUpdate(cb: () => void): void
```

**Description.** Registers a callback to run before the main update phase.

**Returns:** `void`

#### onAfterUpdate(cb)

**Signature:**
```ts
function onAfterUpdate(cb: () => void): void
```

**Description.** Registers a callback to run after the main update phase.

**Returns:** `void`

#### onRender(cb)

**Signature:**
```ts
function onRender(cb: (alpha: number) => void): void
```

**Description.** Registers a callback to run once per display frame. `alpha` is `1` when `physicsHz` is `0`, and the leftover fraction of a fixed step otherwise.

**Returns:** `void`

### Events

#### defineHooks(map)

**Signature:**
```ts
function defineHooks(map: Record<string, any>): HookDef
```

**Description.** Defines hook types for your game.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| map | `object` | Hook type definitions |

**Returns:** `HookDef`

**Example:**
```ts
const Hooks = defineHooks({
  'player-hit': { damage: Number },
  'level-complete': { time: Number }
});
```

#### emit(event, payload)

**Signature:**
```ts
function emit<K extends keyof GwenRuntimeHooks>(name: K, ...args: Parameters<GwenRuntimeHooks[K]>): void
```

**Description.** Emits a custom event to all listeners registered with [`useHook()`](#usehookevent-handler).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| event | `string` | Event type identifier |
| payload | `any` | Event payload (optional) |

**Returns:** `void`

**Example:**
```ts
emit('player-hit', { damage: 10 });
```

### UI & Layout

#### defineLayout(factory)

**Signature:**
```ts
function defineLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  factory: () => Refs,
): LayoutDefinition<Refs>
```

**Description.** Declares a layout: a factory that places entities with `placeActor`, `placePrefab` and `placeGroup` and returns named handles. The factory runs when `useLayout().load()` is called, not before.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| factory | `() => Refs` | Synchronous function that places entities and returns their handles |

**Returns:** `LayoutDefinition<Refs>`

**Example:**
```ts
const HUD = defineLayout(() => {
  const hud = placeActor(HUDActor, { at: [0, 0] });
  return { hud };
});
```

#### useLayout(layoutDef, options?)

**Signature:**
```ts
function useLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  layoutDef: LayoutDefinition<Refs>,
  options?: UseLayoutOptions,
): LayoutHandle<Refs>
```

**Description.** Returns a handle that loads and disposes one instance of a layout. Call it inside an active engine context. Without `lazy: true` it starts loading at once.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| layoutDef | `LayoutDefinition<Refs>` | Layout produced by `defineLayout()` |
| options.lazy | `boolean` | Defer loading until `load()` is called. Default `false` |
| options.chunkSize | `number` | Spawn at most this many entities per frame. Positive integer. Default: spawn all in one pass |

**Returns:** `LayoutHandle<Refs>` with `load()`, `dispose()`, `refs` and `active`.

**Throws:** `GwenComposableError` with code `COMPOSABLE:INVALID_CHUNK_SIZE` if `chunkSize` is not a positive integer. The message names the value.

**`chunkSize` behaviour.** The factory runs once. Each `place*` call records its spawn. `load()` spawns the recorded entities in call order, at most `chunkSize` per frame, on `engine:before-update`. It resolves when the last one is alive, after `ceil(m / chunkSize)` frames for `m` entities. `refs` is `{}` until then. Reading `entityId`, `api`, `moveTo` or `despawn` on a handle inside the factory throws `COMPOSABLE:LAYOUT_HANDLE_NOT_SPAWNED`. A handle passed as `parent` is read at spawn time, so place the parent first. A second `load()` while loading returns the same promise. `dispose()` during the load stops the spawns, destroys what exists, and resolves the pending `load()` with `active` still `false`. If a spawn throws, `load()` rejects and the entities already spawned are destroyed. See [Layouts](/essentials/layouts#progressive-spawn-with-chunksize).

**Example:**
```ts
const world = useLayout(TownLayout, { lazy: true, chunkSize: 2 });
const loading = world.load();
await engine.advance(1 / 60); // two entities alive
await engine.advance(1 / 60); // ...
await loading;                // every entity alive
```

#### useEntityId()

**Signature:**
```ts
function useEntityId(): bigint
```

**Description.** Returns the ECS entity ID of the actor currently being set up. The value is a `bigint` that uniquely identifies this actor instance for its entire lifetime (from spawn to despawn).

Must be called during the **setup phase** of a `defineActor()` factory — i.e. at the top level of the factory function, not inside `onStart`, `onUpdate`, or other callbacks.

**Returns:** `bigint` — the entity ID of the actor being spawned.

**Throws:** If called outside an active `defineActor()` factory context.

**Example — singleton actor (static key preferred):**
```ts
import { defineActor } from '@gwenjs/core/actor'

export const HudActor = defineActor(HudPrefab, () => {
  // Only one HUD exists — a static key is clearest
  const hud = useHTML('hud', 'score')
})
```

**Example — multiple instances (unique key per actor):**
```ts
import { defineActor, useEntityId } from '@gwenjs/core/actor'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const id = useEntityId()
  const label = useHTML('ui', String(id))  // unique slot per enemy
})
```

**Example — inside a composable:**
```ts
import { useEntityId } from '@gwenjs/core/actor'
import { useService } from '@gwenjs/core/system'
import { onCleanup } from '@gwenjs/core'

export function useSprite(src: string): SpriteHandle {
  const id = useEntityId()
  const service = useService('renderer:canvas')
  const sprite = service.allocateSprite(String(id), src)
  onCleanup(() => sprite.destroy())
  return sprite
}
```

---

#### useTransform()

**Signature:**
```ts
function useTransform(): Transform
```

**Description.** Returns the transform component of the current entity.

**Returns:** `Transform` — with position, rotation, scale properties.

**Example:**
```ts
const transform = useTransform();
transform.x += 10;
```

## `@gwenjs/core/scene`

Scene and router definition.

**Exports:** `defineScene`, `useSystem`, `onEnter`, `onExit`, `defineSceneRouter`, `useSceneRouter`

**Usage:**
```ts
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { defineSceneRouter, useSceneRouter } from '@gwenjs/core/scene'
```

### Scenes

#### defineScene(name, factory)

**Signature:**
```ts
function defineScene(name: string, factory: () => void): SceneFactory
```

**Description.** Defines a game scene. The factory runs inside an engine context at bootstrap — all engine composables are available. Declare systems and lifecycle hooks via composables. The factory result is cached and only executed once.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | Unique scene name (used by the router) |
| factory | `() => void` | Setup function — call `useSystem`, `onEnter`, `onExit` here |

**Returns:** `SceneFactory` — callable with a `.sceneName` property.

**Example:**
```ts
export const GameScene = defineScene('game', () => {
  useSystem([MovementSystem, RenderSystem])

  const player = useActor(PlayerActor)
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

#### useSystem(plugins)

**Signature:**
```ts
function useSystem(plugins: GwenPlugin[]): void
```

**Description.** Declares the systems that run while this scene is active. Must be called inside a `defineScene()` factory.

**Throws:** `GwenContextError` if called outside a `defineScene()` factory.

**Example:**
```ts
defineScene('game', () => {
  useSystem([MovementSystem, RenderSystem, CollisionSystem])
})
```

#### onEnter(cb)

**Signature:**
```ts
function onEnter(cb: (params?: Record<string, unknown>) => void | Promise<void>): void
```

**Description.** Registers a callback fired when the engine routes to this scene. Receives the params passed to `nav.send()`. Must be called inside a `defineScene()` factory.

**Throws:** `GwenContextError` if called outside a `defineScene()` factory.

**Example:**
```ts
defineScene('game', () => {
  const player = useActor(PlayerActor)
  onEnter((params) => {
    player.spawnOnce({ x: params?.startX as number ?? 400, y: 530 })
  })
})
```

#### onExit(cb)

**Signature:**
```ts
function onExit(cb: () => void | Promise<void>): void
```

**Description.** Registers a callback fired when the engine routes away from this scene. Must be called inside a `defineScene()` factory.

**Throws:** `GwenContextError` if called outside a `defineScene()` factory.

**Example:**
```ts
defineScene('game', () => {
  const player = useActor(PlayerActor)
  onExit(() => player.despawnAll())
})
```

#### defineSceneRouter(options)

**Signature:**
```ts
function defineSceneRouter(options: {
  initial: string;
  routes: Record<string, { scene: SceneFactory; on: Record<string, string> }>;
}): SceneRouterDef
```

**Description.** Defines a scene router for managing scene transitions.

**Returns:** `SceneRouterDef`

**Example:**
```ts
defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: { PLAY: 'game' } },
    game: { scene: GameScene, on: { MENU: 'menu' } },
  },
})
```

#### useSceneRouter(routerDef)

**Signature:**
```ts
function useSceneRouter<TRoutes>(
  routerDef: SceneRouterDefinition<TRoutes>
): SceneRouterHandle<TRoutes>
```

**Description.** Returns the runtime handle for a scene router. Call `.send()` to trigger transitions. Must be called inside an active engine context (system, actor, or scene lifecycle hook).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| routerDef | `SceneRouterDefinition` | Router created by `defineSceneRouter()` |

**Returns:** `SceneRouterHandle` — with methods `.send(event, params?)`, `.can(event)`, `.current`, `.params`, `.onTransition(fn)`.

**Example:**
```ts
import { useSceneRouter } from '@gwenjs/core/scene'
import { AppRouter } from '../router'

const nav = useSceneRouter(AppRouter)
await nav.send('START')        // trigger transition
nav.can('START')               // check if valid
nav.current                    // current state name
```
