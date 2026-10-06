# @gwenjs/core

Core primitives for the GWEN game engine — entity management, components, systems, actors, scenes, and the plugin architecture.

## Installation

```bash
npm install @gwenjs/core
```

## Subpath imports

`@gwenjs/core` exposes a root entrypoint and three additional subpath entrypoints to keep bundle sizes small:

| Subpath               | What it exports                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@gwenjs/core`        | `createEngine`, `useEngine`, `defineComponent`, `Types`, `createLogger`, `setupGwen`, `onCleanup`                                                                                                     |
| `@gwenjs/core/system` | `defineSystem`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `useQuery`, `useService`, `useWasmModule`                                                                                  |
| `@gwenjs/core/actor`  | `defineActor`, `onStart`, `onDestroy`, `useEntityId`, `definePrefab`, `useActor`, `useComponent`, `usePrefab`, `useTransform`, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab` |
| `@gwenjs/core/scene`  | `defineScene`, `defineSceneRouter`, `useSceneRouter`                                                                                                                                                  |

## Quick start

```ts
import { setupGwen, defineComponent, Types } from "@gwenjs/core";
import { defineSystem, useQuery, onUpdate } from "@gwenjs/core/system";

// 1. Define components (Structure-of-Arrays)
const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32, y: Types.f32 },
});

const Velocity = defineComponent({
  name: "Velocity",
  schema: { x: Types.f32, y: Types.f32 },
});

// 2. Define a system
const MovementSystem = defineSystem("MovementSystem", () => {
  const entities = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    for (const entity of entities) {
      const pos = entity.get(Position)!;
      const vel = entity.get(Velocity)!;
      pos.x += vel.x * dt;
      pos.y += vel.y * dt;
    }
  });
});

// 3. Create and start the engine. setupGwen() loads WASM. start() is async.
const engine = await setupGwen();
await engine.use(MovementSystem);
await engine.start();
```

## Components

Components describe the data layout of entities. Fields are declared with `Types.*` and component data is stored and accessed via the engine.

```ts
import { defineComponent, Types, useEngine } from "@gwenjs/core";

const Health = defineComponent({
  name: "Health",
  schema: { hp: Types.f32, max: Types.f32 },
});

// Add component data to an entity
const engine = useEngine();
engine.addComponent(entityId, Health, { hp: 100, max: 100 });

// Read in a system via entity accessor
for (const entity of entities) {
  const health = entity.get(Health);
  if (health && health.hp <= 0) {
    /* ... */
  }
}
```

Available types: `Types.f32`, `Types.f64`, `Types.i32`, `Types.i64`, `Types.u32`, `Types.u64`, `Types.bool`, `Types.string`, `Types.persistentString`, `Types.vec2`, `Types.vec3`, `Types.vec4`, `Types.quat`, `Types.color`.

## Systems

Systems run game logic every frame. Use `useQuery` to iterate entities and frame hooks to schedule work.

```ts
import {
  defineSystem,
  useQuery,
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
} from "@gwenjs/core/system";

const PhysicsSystem = defineSystem("PhysicsSystem", () => {
  const entities = useQuery([Position, Velocity]);

  onBeforeUpdate((dt) => {
    /* runs before update */
  });
  onUpdate((dt) => {
    /* main update */
  });
  onAfterUpdate((dt) => {
    /* runs after update */
  });
  onRender(() => {
    /* render pass */
  });
});
```

`useQuery` must be called during the setup phase, not inside a frame hook.

## Actors

Actors are entity-bound objects with a lifecycle. Use `defineActor` for interactive game objects.

```ts
import { defineActor, onStart, onDestroy, definePrefab, useComponent } from "@gwenjs/core/actor";

const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { hp: 100, max: 100 } },
]);

const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  const health = useComponent<{ hp: number; max: number }>(Health);

  onStart(() => {
    health.hp = props.hp;
    health.max = props.hp;
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

// Register and spawn
await engine.use(EnemyActor._plugin);
const id = EnemyActor._plugin.spawn({ hp: 50 });
EnemyActor._plugin.despawn(id);
```

### Lifecycle hooks (actor only)

| Hook            | When              |
| --------------- | ----------------- |
| `onStart(fn)`   | Once, after spawn |
| `onDestroy(fn)` | Once, on despawn  |

### `useEntityId`

Returns the entity ID of the actor being set up. Valid only during the `defineActor` factory function (including composables called from it).

```ts
const MyActor = defineActor(MyPrefab, () => {
  const id = useEntityId(); // bigint
});
```

## Events

```ts
import { defineHooks, emit, useHook } from '@gwenjs/core'

export const GameHooks = defineHooks({
  'player:died': (): void => undefined,
  'enemy:hit': (_damage: number): void => undefined,
})

emit('enemy:hit', 42)

useHook('enemy:hit', (damage) => { ... })
```

## Scenes

```ts
import { defineScene, defineSceneRouter, useSceneRouter } from '@gwenjs/core/scene'

const MenuScene = defineScene({
  name: 'menu',
  systems: [MenuSystem],
})

const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, PhysicsSystem],
})

const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: { START: 'game' } },
    game: { scene: GameScene, on: { PAUSE: 'menu' } },
  },
})

// Navigate — useSceneRouter must be called inside an engine context
const PlayerActor = defineActor(PlayerPrefab, () => {
  const nav = useSceneRouter(AppRouter)
  onUpdate(() => {
    if (/* game over */) nav.send('PAUSE')
  })
  return {}
})

// Or inside a system
const NavSystem = defineSystem('NavSystem', () => {
  const nav = useSceneRouter(AppRouter)
  onUpdate(() => {
    console.log(nav.current)
  })
})
```

## Plugin system

```ts
import { setupGwen } from "@gwenjs/core";

const engine = await setupGwen();

// Plugins are GwenPlugin objects returned by defineSystem, defineActor._plugin, etc.
await engine.use(MovementSystem);
await engine.use(EnemyActor._plugin);

await engine.start();
await engine.stop();
```

## Logger

```ts
import { createLogger } from "@gwenjs/core";

const log = createLogger("game:my-system");
log.info("hello");
log.warn("something odd");
log.error("oops");
```

## License

[MPL-2.0](./LICENSE)

## Public exports

### `.`

Values: `ActorErrorCodes`, `ComposableErrorCodes`, `CoreErrorCodes`, `GwenActorError`, `GwenComposableError`, `GwenConfigError`, `GwenContextError`, `GwenLogger`, `GwenPluginNotFoundError`, `Types`, `consoleLogProvider`, `createEngine`, `createEntityId`, `createErrorBus`, `createLogger`, `defineComponent`, `defineHooks`, `defineSequence`, `emit`, `onCleanup`, `setupGwen`, `unpackEntityId`, `useEngine`, `useHook`, `useTween`, `withAsyncContext`, `withCleanup`

Types: `Color`, `ComponentAccessor`, `ComponentBody`, `ComponentDefinition`, `ComponentSchema`, `ComponentType`, `CoreVariant`, `EasingName`, `EngineConfig`, `EngineErrorBus`, `EngineErrorPayload`, `EngineFramePhaseMs`, `EngineState`, `EngineStats`, `EntityId`, `GwenDisposable`, `GwenEngine`, `GwenEngineOptions`, `GwenHookable`, `GwenHooks`, `GwenPlugin`, `GwenPluginNotFoundErrorOptions`, `GwenProvides`, `GwenRuntimeHooks`, `HookHandlerMap`, `IGwenLogger`, `InferComponent`, `InferHooks`, `InferSchemaType`, `LogEntry`, `LogLevel`, `MemoryRegion`, `PlacementBridge`, `PluginErrorContext`, `SchemaLayout`, `SchemaType`, `TweenHandle`, `TweenOptions`, `TweenableValue`, `Vector2D`, `WasmBridge`, `WasmChannelOptions`, `WasmMemoryOptions`, `WasmMemoryRegion`, `WasmModuleHandle`, `WasmModuleOptions`, `WasmRegionView`, `WasmRingBuffer`

### `./system`

Values: `defineSystem`, `onAfterUpdate`, `onBeforeUpdate`, `onRender`, `onUpdate`, `useComponentFor`, `useQuery`, `useService`, `useWasmModule`

Types: `ComponentDef`, `DiscoverablePlugin`, `EntityAccessor`, `LiveQuery`

### `./actor`

Values: `DormantTag`, `PoolExhaustedError`, `defineActor`, `defineActorPool`, `defineLayout`, `definePrefab`, `onAfterUpdate`, `onBeforeUpdate`, `onDestroy`, `onDisable`, `onEnable`, `onRelease`, `onRender`, `onReset`, `onStart`, `onUpdate`, `placeActor`, `placeGroup`, `placePrefab`, `useActor`, `useActorPool`, `useActorQuery`, `useChildren`, `useComponent`, `useEntityId`, `useLayout`, `usePrefab`, `useTransform`, `watchActorLeaks`

Types: `ActorDefinition`, `ActorHandle`, `ActorInstance`, `ActorPlugin`, `ActorPool`, `ChildrenHandle`, `CustomScope`, `LayoutDefinition`, `LayoutHandle`, `PlaceHandle`, `PoolHooks`, `PoolOptions`, `PoolStats`, `PrefabComponentEntry`, `PrefabDefinition`, `PrefabHandle`, `RenderFn`, `TransformHandle`, `UpdateFn`, `UseLayoutOptions`, `VoidFn`, `WatchActorLeaksOptions`

### `./scene`

Values: `defineScene`, `defineSceneRouter`, `onEnter`, `onExit`, `onTransitionEnter`, `onTransitionLeave`, `useSceneRouter`, `useSystem`

Types: `EventsOf`, `RouteConfig`, `SceneDefinition`, `SceneFactory`, `SceneInput`, `SceneRegistry`, `SceneRouterDefinition`, `SceneRouterHandle`, `SceneRouterOptions`, `StatesOf`, `SystemHandle`, `TransitionEffect`

### `./tween`

Values: `defineSequence`, `easeInBack`, `easeInBounce`, `easeInCubic`, `easeInElastic`, `easeInExpo`, `easeInOutBack`, `easeInOutBounce`, `easeInOutCubic`, `easeInOutElastic`, `easeInOutExpo`, `easeInOutQuad`, `easeInOutQuart`, `easeInOutSine`, `easeInQuad`, `easeInQuart`, `easeInSine`, `easeOutBack`, `easeOutBounce`, `easeOutCubic`, `easeOutElastic`, `easeOutExpo`, `easeOutQuad`, `easeOutQuart`, `easeOutSine`, `linear`, `spring`, `useTween`

Types: `EasingName`, `TweenHandle`, `TweenOptions`, `TweenableValue`

### `./system/module`

Values: `default`

Types: none

### `./actor/module`

Values: `default`

Types: none

### `./scene/module`

Values: `default`

Types: none

### `./router/module`

Values: `default`

Types: none

### `./tween/module`

Values: `default`

Types: none

### `./testing`

Values: `createRealEngine`

Types: `CreateRealEngineOptions`, `RealEngineHandle`

### `./internal`

no semver guarantee — framework packages and generated code only

Values: `EASING_MAP`, `FLAGS_OFFSET`, `FLAG_PHYSICS_ACTIVE`, `GlobalStringPoolManager`, `GwenScope`, `MAX_SAB_BYTES`, `SENTINEL`, `SharedMemoryManager`, `StringPool`, `StringPoolManager`, `TRANSFORM3D_STRIDE`, `TRANSFORM_OFFSETS`, `TRANSFORM_STRIDE`, `Transform3D`, `TweenManager`, `TweenPlugin`, `TweenPool`, `WasmBridgeImpl`, `_getActorEntityId`, `buildTransformImports`, `createDisposable`, `createGwenHooks`, `detectCoreVariant`, `engineContext`, `entityIndex`, `executeAsync`, `getTweenManager`, `getWasmBridge`, `readTransform3DPosition`, `readTransform3DRotation`, `readTransform3DScale`, `writeTransform3DPosition`, `writeTransform3DRotation`, `writeTransform3DScale`

Types: `GwenCoreWasm`, `GwenTransformImports`, `InitWasmOptions`, `TweenPluginOptions`, `TweenPoolPolicy`, `TweenSlot`, `WasmEngine`, `WasmEnginePhysics2D`, `WasmEnginePhysics3D`, `WasmEntityId`

### `./wasm/light`

Values: `Engine`, `JsEntityId`, `default`, `initSync`

Types: `InitInput`, `InitOutput`, `SyncInitInput`

### `./wasm/physics2d`

Values: `Engine`, `JsEntityId`, `default`, `find_path_2d`, `get_collision_event_count`, `get_collision_events_ptr`, `get_path_buffer_ptr`, `initSync`

Types: `InitInput`, `InitOutput`, `SyncInitInput`

### `./wasm/physics3d`

Values: `Engine`, `JsEntityId`, `default`, `find_path_3d`, `get_path_buffer_ptr_3d`, `initSync`, `init_navgrid_3d`

Types: `InitInput`, `InitOutput`, `SyncInitInput`
