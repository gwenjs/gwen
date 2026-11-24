---
title: "@gwenjs/physics-core"
description: Shared physics types, layer masks and collision-event readers for both dimensions.
---

# @gwenjs/physics-core

`pnpm add @gwenjs/physics-core`

One declaration of a collider option, a sensor callback and a layer mask. `@gwenjs/physics2d` and `@gwenjs/physics3d` adapt this package. They do not declare those shapes again.

```ts check
import { defineLayers } from "@gwenjs/physics-core";
import type { KinematicBodyOptions } from "@gwenjs/physics-core";

const masks = defineLayers({ ground: 1 << 0, player: 1 << 1 });
const player: number = masks.player;

const pose: KinematicBodyOptions<"2d"> = {
  initialPosition: { x: 0, y: 2 },
  initialRotation: 0,
};
```

## Layers

`defineLayers` returns its input. Its values are masks (`1 << 0`, `1 << 1`). The values of `LayerRegistry` and `PhysicsConfigBase.layers` are bit indices. `LayerRegistry.resolve` turns a name into `1 << bit`, keeps a number, and OR-s an array. The registry accepts at most 32 layers. A bit must be an integer from 0 to 31. An unknown name is an error.

The codes passed to `onError` are `LAYER_ERROR_CODES`. They have no dimension prefix. The dimension package maps them onto its own codes.

## Events

`readCollisionEvents` fills a caller-owned pool.

Stride 16 is the 3D layout: flags `u32` at +8, collider ids `u16` at +12 and +14. An id of `0xffff` is absent.

Stride 20 is the live 2D layout: collider ids `u32` at +8 and +12, flags `u8` at +16. An id of `0xffffffff` is absent.

A count of 0 writes nothing. A count past the pool stops at the pool.

## Callbacks

`onContact`, `onSensorEnter` and `onSensorExit` use the current engine. Outside that context they throw `GwenContextError` with code `CORE:OUTSIDE_ENGINE_CONTEXT`. Each engine's list dies with that engine's `stop()`. A removal during `emit` waits until the outermost `emit` returns, and that entry stays in the list for the walk. Outside `emit` the entry drops at once. `clearEngineContacts` and `stop()` empty the lists at once, even during a walk. `ContactRegistry.removeEntity` drops every entry for that entity. `SensorRegistry.remove` drops every entry whose callback is in the list. An empty `remove` drops nothing. `onSensorEnter` and `onSensorExit` take an optional `ownerEntityId`. When it is passed, the callback runs only for that entity. When it is omitted, the callback runs for every entity. `emit` keeps registration order and skips a set owner that is not the event entity. `SensorRegistry.removeOwned(entityId, sensorId?)` drops that owner's callbacks. A `sensorId` drops only that sensor. A second call drops nothing. During `emit` the drop waits until the outermost `emit` returns.

## Module

`definePhysicsModule` builds a module from a `PhysicsModuleDefinition`. Its `setup` registers the plugin declaration with the resolved options, copies the auto-imports in the given order, and adds the Vite plugin built from those options. `defaults` and `validate` stay the objects the caller passed. An empty name is rejected with code `KIT:MODULE_INVALID`.

## Plugin

`createPhysicsPlugin` builds a plugin from a `PhysicsAdapter`. `setup` stores `api` under the service key and routes `prefab:instantiate`, `entity:destroy`, `engine:before-update` and `engine:update` to that adapter. `beginFrame`, when the adapter has one, runs on every `engine:before-update`. `step` runs only when `dt > 0`. On `engine:update` the plugin reads `eventView`. No view, or a count of 0, emits nothing. Otherwise sensor transitions run first. Inside one transition, `onSensorEnter` or `onSensorExit` runs, then the `physics:sensor:changed` hook. When the resolved contact list is empty, the plugin calls neither `physics:collision`, nor `onContact`, nor `onContacts`. Sensor transitions of that frame still run. When the list is not empty, the order continues with the `physics:collision` hook, the `onContact` callbacks, then `onContacts`. An enter fires only when an entity and sensor go from 0 overlaps to 1. An exit fires only from 1 to 0. The count never drops below 0. An id `resolveSensorId` does not accept does not change that sensor. Destroying an entity forgets that entity's sensor counts. No exit and no `physics:sensor:changed` is fired for it. A rejected `physics:collision` handler is reported on the engine error bus with code `CORE:PLUGIN_RUNTIME_ERROR` and the plugin name as source. `makeAdapter` receives that plugin's `PhysicsSensorTracker`. `read` and `update` share the dispatch counts. `update` emits nothing. `teardown` clears that engine's contact and sensor callbacks, then calls `dispose`. A second `teardown` does not clear callbacks registered after the first, and does not call `dispose` again. A throw from the adapter factory is the error `engine.use` rejects with.
