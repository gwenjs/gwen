# @gwenjs/core

Core primitives for the GWEN game engine — entity management, components, systems, actors, scenes, and the plugin architecture.

## Installation

```bash
npm install @gwenjs/core
```

## Subpath imports

`@gwenjs/core` is split into three subpaths to keep bundle sizes small:

| Subpath | What it exports |
|---|---|
| `@gwenjs/core` | `createEngine`, `useEngine`, `defineComponent`, `Types`, `createLogger`, `initWasm`, `onCleanup` |
| `@gwenjs/core/system` | `defineSystem`, `onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`, `useQuery`, `useService`, `useWasmModule` |
| `@gwenjs/core/actor` | `defineActor`, `onStart`, `onDestroy`, `onEvent`, `useEntityId`, `definePrefab`, `defineEvents`, `emit`, `useActor`, `useComponent`, `usePrefab`, `useTransform`, `defineLayout`, `useLayout`, `placeActor`, `placeGroup`, `placePrefab` |
| `@gwenjs/core/scene` | `defineScene`, `defineSceneRouter`, `useSceneRouter` |

## Quick start

```ts
import { createEngine, defineComponent, Types } from '@gwenjs/core'
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'

// 1. Define components (Structure-of-Arrays)
const Position = defineComponent({
  name: 'Position',
  schema: { x: Types.f32, y: Types.f32 },
})

const Velocity = defineComponent({
  name: 'Velocity',
  schema: { x: Types.f32, y: Types.f32 },
})

// 2. Define a system
const MovementSystem = defineSystem('MovementSystem', () => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})

// 3. Create and start the engine
const engine = await createEngine()
await engine.use(MovementSystem)
engine.start()
```

## Components

Components use a Structure-of-Arrays layout — data for a field across all entities is stored in a typed array, indexed by entity ID.

```ts
import { defineComponent, Types } from '@gwenjs/core'

const Health = defineComponent({
  name: 'Health',
  schema: { hp: Types.f32, max: Types.f32 },
})

// Access component data by entity ID
Health.hp[entityId] = 100
Health.max[entityId] = 100
```

Available types: `Types.f32`, `Types.f64`, `Types.i32`, `Types.ui32`, `Types.i16`, `Types.ui16`, `Types.i8`, `Types.ui8`, `Types.bool`.

## Systems

Systems run game logic every frame. Use `useQuery` to iterate entities and frame hooks to schedule work.

```ts
import { defineSystem, useQuery, onUpdate, onBeforeUpdate, onAfterUpdate, onRender } from '@gwenjs/core/system'

const PhysicsSystem = defineSystem('PhysicsSystem', () => {
  const entities = useQuery([Position, Velocity])

  onBeforeUpdate((dt) => { /* runs before update */ })
  onUpdate((dt) => { /* main update */ })
  onAfterUpdate((dt) => { /* runs after update */ })
  onRender(() => { /* render pass */ })
})
```

`useQuery` must be called during the setup phase, not inside a frame hook.

## Actors

Actors are entity-bound objects with a lifecycle. Use `defineActor` for interactive game objects.

```ts
import { defineActor, onStart, onDestroy, onEvent, definePrefab, defineEvents, useEntityId } from '@gwenjs/core/actor'

const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { hp: 100, max: 100 } },
])

const EnemyEvents = defineEvents({
  'enemy:hit': (damage: number) => {},
})

const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  const entityId = useEntityId()

  onStart(() => {
    Health.hp[entityId] = props.hp
  })

  onDestroy(() => {
    console.log('Enemy destroyed')
  })

  return {
    takeDamage: (n: number) => {
      Health.hp[entityId] -= n
    },
  }
})

// Register and spawn
await engine.use(EnemyActor._plugin)
const id = EnemyActor._plugin.spawn({ hp: 50 })
EnemyActor._plugin.despawn(id)
```

### Lifecycle hooks (actor only)

| Hook | When |
|---|---|
| `onStart(fn)` | Once, after spawn |
| `onDestroy(fn)` | Once, on despawn |
| `onEvent(event, fn)` | On event — automatically removed on despawn |

### `useEntityId`

Returns the entity ID of the actor being set up. Valid only during the `defineActor` factory function (including composables called from it).

```ts
const MyActor = defineActor(MyPrefab, () => {
  const id = useEntityId() // bigint
})
```

## Events

```ts
import { defineEvents, emit, onEvent } from '@gwenjs/core/actor'
import { useEngine } from '@gwenjs/core'

// Declare the event contract
export const GameEvents = defineEvents({
  'player:died': () => {},
  'enemy:hit': (damage: number) => {},
})

// Emit from anywhere
emit('enemy:hit', 42)

// Listen inside an actor (auto-cleaned up on despawn)
onEvent('enemy:hit', (damage) => { ... })

// Listen from a system
const engine = useEngine()
engine.hooks.hook('enemy:hit', (damage) => { ... })
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

// Navigate
const nav = useSceneRouter(AppRouter)
await nav.send('START')
console.log(nav.current) // 'game'
```

## Plugin system

```ts
import { createEngine } from '@gwenjs/core'

const engine = await createEngine()

// Plugins are GwenPlugin objects returned by defineSystem, defineActor._plugin, etc.
await engine.use(MovementSystem)
await engine.use(EnemyActor._plugin)

engine.start()
engine.stop()
```

## Logger

```ts
import { createLogger } from '@gwenjs/core'

const log = createLogger('game:my-system')
log.info('hello')
log.warn('something odd')
log.error('oops')
```

## License

MIT
