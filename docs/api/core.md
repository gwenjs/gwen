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
defineSystem({
  setup() {
    const engine = useEngine();
    console.log(engine.deltaTime);
  }
});
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
function defineSystem(options: {
  setup: (ctx: SystemContext) => void;
}): SystemDef
```

**Description.** Defines a system that runs once during initialization. Use lifecycle hooks and queries inside setup.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.setup | `function` | Setup function called once at initialization |

**Returns:** `SystemDef` — system definition for scene registration.

**Example:**
```ts
defineSystem({
  setup() {
    const query = useQuery([Transform, Velocity]);
    onUpdate((dt) => {
      for (const entity of query) {
        entity.transform.x += entity.velocity.x * dt;
      }
    });
  }
});
```

#### useQuery(components, opts?)

**Signature:**
```ts
function useQuery<C extends ComponentDef[]>(
  components: C,
  opts?: { onChange?: (added: Entity[], removed: Entity[]) => void }
): LiveQuery
```

**Description.** Creates a live query that iterates over all entities with the specified components. The query updates automatically when entities match/unmatch.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| components | `ComponentDef[]` | Components to query for |
| opts.onChange | `function` | Called when entities are added/removed from query |

**Returns:** `LiveQuery` — an iterable set of matching entities.

**Example:**
```ts
const query = useQuery([Position, Velocity]);
onUpdate(() => {
  for (const entity of query) {
    // Update position
  }
});
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

**Exports:** `defineActor`, `onStart`, `onDestroy`, `onEvent`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `definePrefab`, `defineEvents`, `emit`, `useActor`, `useComponent`, `usePrefab`, `useTransform`, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab`

**Usage:**
```ts
import { defineActor, onStart, onDestroy, onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from '@gwenjs/core/actor'
import { definePrefab, defineEvents, emit, useActor, useComponent, usePrefab } from '@gwenjs/core/actor'
import { useTransform, defineLayout, useLayout, placeActor, placeGroup, placePrefab } from '@gwenjs/core/actor'
```

### Actors

#### defineActor(name, setup)

**Signature:**
```ts
function defineActor(name: string, setup: (ctx: ActorContext) => void): ActorDef
```

**Description.** Defines an actor (entity template) with components and lifecycle setup.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | Unique actor name |
| setup | `function` | Setup function to initialize the actor |

**Returns:** `ActorDef` — actor definition for spawning.

**Example:**
```ts
const Player = defineActor('Player', (setup) => {
  useComponent(Transform);
  useComponent(Health);
  
  onAdd((entity) => {
    console.log('Player spawned');
  });
});
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
defineActor('Player', setup() {
  useComponent(Health);
});
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
  scenes: Record<string, SceneDef>;
}): SceneRouterDef
```

**Description.** Defines a scene router for managing scene transitions.

**Returns:** `SceneRouterDef`

**Example:**
```ts
defineSceneRouter({
  initial: 'Menu',
  scenes: { Menu: MenuScene, Game: GameScene }
});
```

#### useSceneRouter()

**Signature:**
```ts
function useSceneRouter(): SceneRouter
```

**Description.** Returns the active scene router. Use to transition between scenes.

**Returns:** `SceneRouter` — with methods like `.goTo(name)`.

**Example:**
```ts
const router = useSceneRouter();
router.goTo('Game');
```

---

## Legacy Sections (Reorganized Above)

#### defineComponent(options)

**Signature:**
```ts
function defineComponent<T = {}>(options: {
  name: string;
  schema?: T;
  onAdd?: (entity: Entity) => void;
  onRemove?: (entity: Entity) => void;
}): ComponentDef<T>
```

**Description.** Defines a component type with optional schema and lifecycle hooks.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options | `object` | Component definition |
| options.name | `string` | Unique component name |
| options.schema | `T` | Field schema using Types (optional) |
| options.onAdd | `function` | Called when component is added to an entity |
| options.onRemove | `function` | Called when component is removed |

**Returns:** `ComponentDef<T>` — component definition for use in actors/scenes.

**Example:**
```ts
const Health = defineComponent({
  name: 'Health',
  schema: {
    hp: Types.f32,
    maxHp: Types.f32
  },
  onAdd(entity) {
    console.log('Entity took health component');
  }
});
```

### Types

**Signature:**
```ts
const Types = {
  f32: Type,
  f64: Type,
  i32: Type,
  ui32: Type,
  i8: Type,
  ui8: Type,
  i16: Type,
  ui16: Type
}
```

**Description.** Type constants for defining component schemas.

**Example:**
```ts
schema: {
  position: Types.f32,
  count: Types.i32
}
```

### Utilities

#### createLogger(name, opts?)

**Signature:**
```ts
function createLogger(name: string, opts?: LoggerOptions): GwenLogger
```

**Description.** Creates a named logger instance for debugging and logging.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| name | `string` | Logger namespace name |
| opts | `object` | Logger options (optional) |

**Returns:** `GwenLogger` — with methods: `.info()`, `.warn()`, `.error()`, `.debug()`

**Example:**
```ts
const log = createLogger('Player');
log.info('Player spawned');
```

#### useTween(options)

**Signature:**
```ts
function useTween(options: {
  duration: number;
  easing?: EasingFunction;
  loop?: boolean;
  onProgress?: (t: number) => void;
  onComplete?: () => void;
}): TweenHandle
```

**Description.** Creates an animation tween. Returns a handle with `.play()`, `.stop()`, and `.to(target)` methods.

**Parameters:**
| Param | Type | Description |
|---|---|---|
| options.duration | `number` | Duration in seconds |
| options.easing | `function` | Easing function (optional) |
| options.loop | `boolean` | Loop animation (optional) |
| options.onProgress | `function` | Progress callback (0–1) |
| options.onComplete | `function` | Completion callback |

**Returns:** `TweenHandle` — tween controller.

**Example:**
```ts
const tween = useTween({
  duration: 1,
  onProgress: (t) => { entity.x = lerp(0, 100, t); }
});
tween.play();
```

#### createGwenHooks()

**Signature:**
```ts
function createGwenHooks(): GwenHooks
```

**Description.** Creates a hooks instance for advanced plugin development.

**Returns:** `GwenHooks`

## Error Handling

### CoreErrorCodes

**Signature:**
```ts
enum CoreErrorCodes {
  INVALID_COMPONENT = 'INVALID_COMPONENT',
  INVALID_SYSTEM = 'INVALID_SYSTEM',
  INVALID_ACTOR = 'INVALID_ACTOR',
  SCENE_NOT_FOUND = 'SCENE_NOT_FOUND',
  // ... other error codes
}
```

**Description.** Enumeration of error codes thrown by the core engine.

## Context

### engineContext

**Signature:**
```ts
const engineContext: AsyncLocalStorage<GwenEngine>
```

**Description.** Raw async context storage for the current engine. Typically not needed; use [`useEngine()`](#useengine) instead.
