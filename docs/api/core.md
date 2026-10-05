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

### createEngine(options)

**Signature:**
```ts
function createEngine(options: GwenEngineOptions): GwenEngine
```

**Description.** Creates and initializes the GWEN engine with the provided configuration. This is the foundation of your game/app.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `GwenEngineOptions` | Engine configuration (scenes, plugins, etc.) |

**Returns:** `GwenEngine` — the initialized engine instance.

**Example:**
```ts
const engine = await createEngine({
  maxEntities: 10_000,
  variant: 'physics2d',
  debug: true,
})
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
| `0` | Paused — all systems receive `dt = 0` |
| `0.5` | Half speed (slow motion) |
| `2` | Double speed |

Clamped to `[0, 100]` at runtime. Applied after the `maxDeltaSeconds` safety cap — time dilation never causes physics instability.

```ts
// Pause the simulation
engine.timeScale = 0

// Bullet time
engine.timeScale = 0.2

// SimCity fast-forward
engine.timeScale = 4

// Resume
engine.timeScale = 1
```

::: tip Pause vs freeze
`timeScale = 0` pauses all systems by delivering `dt = 0` — hooks still fire. To skip frame processing entirely, stop the loop with `engine.stop()`.
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
```ts
export const moveSystem = defineSystem(function moveSystem() {
  const query = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of query) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

#### useQuery(components)

**Signature:**
```ts
function useQuery<const C extends readonly ComponentDef[]>(components: C): LiveQuery<EntityAccessor<C>>
```

**Description.** Creates a live query that iterates over all entities with the specified components. The query updates automatically when entities match/unmatch.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| components | `ComponentDef[]` | Components to query for |

**Returns:** `LiveQuery` — an iterable set of matching entities.

**Example:**
```ts
const enemies = useQuery([Position, EnemyTag])

onUpdate(() => {
  for (const id of enemies) {
    Position.x[id] += 1
  }
})
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
```ts
import { defineActor, definePrefab, onStart, onDestroy, useEntityId } from '@gwenjs/core/actor'

const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health,   defaults: { hp: 100 } },
])

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  const entityId = useEntityId()
  onStart(() => {
    Health.hp[entityId] = props.hp
  })
  onDestroy(() => {
    console.log('Enemy destroyed')
  })
  return {
    takeDamage: (n: number) => { Health.hp[entityId] -= n },
  }
})

// Register at startup
await engine.use(EnemyActor._plugin)

// Spawn and despawn via useActor() inside a system or actor:
const SpawnerSystem = defineSystem(() => {
  const enemies = useActor(EnemyActor)
  const id = enemies.spawn({ hp: 50 })
  enemies.despawn(id)
})
```

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
  const nearby = useActorQuery(EnemyActor, inRange)

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
| `query` | `Iterable<{ readonly id: EntityId }>` | Any iterable exposing entity IDs — typically a `LiveQuery` from `useQuery` |

**Returns:** `Iterable<A>` — lazy, zero-allocation. Entities in `query` with no live actor instance are silently skipped.

::: tip Why does it accept a query instead of component definitions?
`useActorQuery` lives in `@gwenjs/core/actor` and does not depend on the system layer. Accepting a pre-built `LiveQuery` keeps the two layers decoupled and makes the function composable with any iterable that exposes an `id`.
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
function onRender(cb: () => void): void
```

**Description.** Registers a callback to run during the render phase.

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

#### defineLayout(name, setup)

**Signature:**
```ts
function defineLayout(name: string, setup: (ctx: LayoutContext) => void): LayoutDef
```

**Description.** Defines a persistent UI layer that overlays the game.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | Unique layout name |
| setup | `function` | Setup function for UI initialization |

**Returns:** `LayoutDef`

**Example:**
```ts
const HUD = defineLayout('HUD', (setup) => {
  // Initialize UI elements
});
```

#### useLayout()

**Signature:**
```ts
function useLayout(): Layout
```

**Description.** Returns the current layout context. Use to add/remove UI elements.

**Returns:** `Layout`

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
