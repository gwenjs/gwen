---
title: "@gwenjs/physics-core"
description: Shared physics types, layer masks and collision-event readers for both dimensions.
---

# @gwenjs/physics-core

`pnpm add @gwenjs/physics-core`

One declaration of a collider option, a sensor callback and a layer mask. `@gwenjs/physics2d` and `@gwenjs/physics3d` adapt this package. They do not declare those shapes again.

```ts check
import { defineLayers } from '@gwenjs/physics-core'
import type { KinematicBodyOptions } from '@gwenjs/physics-core'

const masks = defineLayers({ ground: 1 << 0, player: 1 << 1 })
const player: number = masks.player

const pose: KinematicBodyOptions<'2d'> = {
  initialPosition: { x: 0, y: 2 },
  initialRotation: 0,
}
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

`onContact`, `onSensorEnter` and `onSensorExit` use the current engine. Outside that context they throw `GwenContextError` with code `CORE:OUTSIDE_ENGINE_CONTEXT`. Each engine's list dies with that engine's `stop()`.
