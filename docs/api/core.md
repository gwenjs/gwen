---
title: "@gwenjs/core"
description: "API reference for @gwenjs/core."
---

# @gwenjs/core API Reference

`pnpm add @gwenjs/core`

## `@gwenjs/core` — Engine

The flat import. Engine bootstrap, shared types, WASM utilities, tween.

**Key exports:** `createEngine`, `useEngine`, `GwenContextError`, `GwenPlugin` (type), `GwenEngine` (type), `GwenProvides` (type), `GwenRuntimeHooks` (type), `createLogger`, `initWasm`, tween utilities.

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

### useTween(options)

**Signature:**
```ts
function useTween<T>(options: {
  duration: number
  easing?: string
  loop?: boolean
  yoyo?: boolean
}): TweenHandle<T>
```

**Description.** Creates an animation tween. Returns a handle with methods to play, pause, reset, queue follow-ups, and register completion callbacks.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.duration | `number` | Duration in seconds |
| options.easing | `string` | Easing function name (optional) |
| options.loop | `boolean` | Loop animation (optional) |
| options.yoyo | `boolean` | Reverse animation on loop (optional) |

**Returns:** `TweenHandle<T>` — tween controller with methods: `.play({ from, to })`, `.pause()`, `.reset()`, `.to({ value, duration })`, `.onComplete(cb)`, `.onLoop(cb)`, and properties: `.value`, `.playing`.

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
function useQuery(components: ComponentDef[]): LiveQuery
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
function useService(name: string): any
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
function useWasmModule(name: string): any
```

**Description.** Returns a WASM module loaded by a plugin.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | WASM module name |

**Returns:** `any` — the WASM module handle.

## `@gwenjs/core/actor`

Actor definition, instance lifecycle, and all actor composables.

**Exports:** `defineActor`, `onStart`, `onDestroy`, `onEvent`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `definePrefab`, `defineEvents`, `emit`, `useActor`, `useComponent`, `usePrefab`, `useEntityId`, `useTransform`, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab`

**Usage:**
```ts
import { defineActor, onStart, onDestroy, onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from '@gwenjs/core/actor'
import { definePrefab, defineEvents, emit, useActor, useComponent, usePrefab } from '@gwenjs/core/actor'
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

**Description.** Defines an actor — an entity template with lifecycle hooks and a public API. The `factory` runs once per spawned instance; register lifecycle hooks (`onStart`, `onUpdate`, `onDestroy`, `onEvent`) inside it. The returned object becomes the actor's public API.

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

// Spawn and despawn via _plugin:
await engine.use(EnemyActor._plugin)
const id = EnemyActor._plugin.spawn({ hp: 50 })
EnemyActor._plugin.despawn(id)
```

#### useActor(ActorDef)

**Signature:**
```ts
function useActor(def: ActorDef): void
```

**Description.** Registers an actor for use within another actor (composition).

**Returns:** `void`

#### useComponent(ComponentDef)

**Signature:**
```ts
function useComponent<T = {}>(def: ComponentDef<T>): void
```

**Description.** Registers a component for use in the current actor during setup.

**Returns:** `void`

**Example:**
```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  const entityId = useEntityId()
  const hp = useComponent(Health)
  onStart(() => {
    console.log('hp:', hp.hp[entityId])
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

#### definePrefab(options)

**Signature:**
```ts
function definePrefab(options: {
  name: string;
  components: ComponentDef[];
  defaults?: Record<string, any>;
}): PrefabDef
```

**Description.** Defines a reusable entity template (prefab) with predefined components and default values.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.name | `string` | Unique prefab name |
| options.components | `ComponentDef[]` | Components to include |
| options.defaults | `object` | Default component property values |

**Returns:** `PrefabDef` — prefab definition.

**Example:**
```ts
const BulletPrefab = definePrefab({
  name: 'Bullet',
  components: [Transform, Velocity],
  defaults: {
    transform: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 }
  }
});
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

#### onEvent(type, handler)

**Signature:**
```ts
function onEvent<T = any>(type: string, handler: (payload: T) => void): void
```

**Description.** Registers a handler for custom events emitted with [`emit()`](#emitevent-payload).

**Parameters:**
| Param | Type | Description |
|---|---|---|
| type | `string` | Event type identifier |
| handler | `function` | Handler receiving the event payload |

**Returns:** `void`

**Example:**
```ts
onEvent('player-hit', (damage) => {
  console.log('Player took', damage, 'damage');
});
```

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

#### defineEvents(map)

**Signature:**
```ts
function defineEvents(map: Record<string, any>): EventDef
```

**Description.** Defines event types for your game.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| map | `object` | Event type definitions |

**Returns:** `EventDef`

**Example:**
```ts
const Events = defineEvents({
  'player-hit': { damage: Number },
  'level-complete': { time: Number }
});
```

#### emit(event, payload)

**Signature:**
```ts
function emit(event: string, payload?: any): void
```

**Description.** Emits a custom event to all listeners registered with [`onEvent()`](#oneventtype-handler).

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

**Exports:** `defineScene`, `defineSceneRouter`, `useSceneRouter`

**Usage:**
```ts
import { defineScene, defineSceneRouter, useSceneRouter } from '@gwenjs/core/scene'
```

### Scenes

#### defineScene(options)

**Signature:**
```ts
function defineScene(options: {
  name: string;
  systems?: SystemDef[];
  actors?: ActorDef[];
}): SceneDef
```

**Description.** Defines a scene with systems and initial actors.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.name | `string` | Unique scene name |
| options.systems | `SystemDef[]` | Systems to run in this scene |
| options.actors | `ActorDef[]` | Initial actors to spawn |

**Returns:** `SceneDef` — scene definition.

**Example:**
```ts
const GameScene = defineScene({
  name: 'Game',
  systems: [PhysicsSystem, InputSystem],
  actors: [Player, Enemy]
});
```

#### defineSceneRouter(options)

**Signature:**
```ts
function defineSceneRouter(options: {
  initial: string;
  routes: Record<string, { scene: SceneDef; on: Record<string, string> }>;
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

