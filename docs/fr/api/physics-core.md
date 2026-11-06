---
title: "@gwenjs/physics-core"
description: Types physiques partagés, masques de calques et lecture des événements de collision.
---

# @gwenjs/physics-core

`pnpm add @gwenjs/physics-core`

Une seule déclaration pour une option de collider, un callback de capteur et un masque de calques. `@gwenjs/physics2d` et `@gwenjs/physics3d` adaptent ce paquet.

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

## Calques

`defineLayers` renvoie le même objet. Ses valeurs sont des masques (`1 << 0`, `1 << 1`). Les valeurs de `LayerRegistry` et de `PhysicsConfigBase.layers` sont des indices de bit. `LayerRegistry.resolve` transforme un nom en `1 << bit`, conserve un nombre, et combine un tableau par OU. Le registre accepte au plus 32 calques. Un bit est un entier de 0 à 31. Un nom inconnu est une erreur.

Les codes passés à `onError` sont `LAYER_ERROR_CODES`. Ils n'ont pas de préfixe de dimension. Le paquet de dimension les transforme en ses propres codes.

## Événements

`readCollisionEvents` remplit un pool fourni par l'appelant.

Le pas de 16 octets est la disposition 3D : drapeaux `u32` à +8, identifiants `u16` à +12 et +14. `0xffff` signifie absent.

Le pas de 20 octets est la disposition 2D en vigueur : identifiants `u32` à +8 et +12, drapeaux `u8` à +16. `0xffffffff` signifie absent.

Un compte de 0 n'écrit rien. Un compte au-delà du pool s'arrête au pool.

## Callbacks

`onContact`, `onSensorEnter` et `onSensorExit` utilisent le moteur courant. Hors de ce contexte, ils lèvent `GwenContextError` avec le code `CORE:OUTSIDE_ENGINE_CONTEXT`. La liste d'un moteur disparaît avec son `stop()`.
