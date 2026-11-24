# `@gwenjs/physics-core`

Shared physics types, layer masks and collision-event readers for `@gwenjs/physics2d` and `@gwenjs/physics3d`.

## Installation

```sh
pnpm add @gwenjs/physics-core
```

## Layers

```ts
import { defineLayers, LayerRegistry } from "@gwenjs/physics-core";

const masks = defineLayers({ ground: 1 << 0, player: 1 << 1 });

function membership(registry: LayerRegistry): number {
  return registry.resolve("player", "membership") | masks.ground;
}
```

`defineLayers` returns the same object. Its values are masks. `LayerRegistry` and `PhysicsConfigBase.layers` hold bit indices. A name resolves to `1 << bit`. A number stays a raw mask. An array is combined with OR.

## Public exports

### `.`

Values: `BODY_KIND_CODE`, `LAYER_ALL`, `LAYER_ERROR_CODES`, `LayerRegistry`, `MAX_LAYERS`, `QUALITY_PRESET_CODE`, `SENSOR_ID_FOOT`, `SHARED_MATERIAL_PRESETS`, `clearEngineContacts`, `createContactRegistry`, `createPhysicsPlugin`, `createSensorRegistry`, `defineLayers`, `onContact`, `onSensorEnter`, `onSensorExit`, `readCollisionEvents`, `resolveMaterial`

Types: `BodyKind`, `BodyOptions`, `BoxColliderOptions`, `CapsuleColliderOptions`, `ColliderFilterOptions`, `CollisionContact`, `CollisionEventLayout`, `ContactRegistry`, `Dim`, `DimRot`, `DimVec`, `InternalCollisionEvent`, `KinematicBodyOptions`, `LayerSelector`, `MaterialTable`, `MaterialValues`, `PhysicsAdapter`, `PhysicsConfigBase`, `PhysicsSensorTracker`, `QualityPreset`, `SensorRegistry`, `SensorState`, `SharedMaterialPreset`, `SphereColliderOptions`

### `./module`

Values: `definePhysicsModule`

Types: `PhysicsModuleDefinition`

## Contacts

`onContact`, `onSensorEnter` and `onSensorExit` subscribe on the current engine. They throw `GwenContextError` with code `CORE:OUTSIDE_ENGINE_CONTEXT` outside that context. `stop()` drops that engine's callbacks. A removal during `emit` waits until the outermost `emit` returns. Outside `emit` it drops the entry at once. `clearEngineContacts` and `stop()` empty the lists at once, even during a walk. `PhysicsSensorTracker.update` writes the same overlap counts as the dispatch and emits nothing.
