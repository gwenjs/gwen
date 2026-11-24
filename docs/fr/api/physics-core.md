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

`onContact`, `onSensorEnter` et `onSensorExit` utilisent le moteur courant. Hors de ce contexte, ils lèvent `GwenContextError` avec le code `CORE:OUTSIDE_ENGINE_CONTEXT`. La liste d'un moteur disparaît avec son `stop()`. Un retrait pendant `emit` attend la fin du `emit` le plus extérieur, et l'entrée reste dans la liste pendant ce parcours. Hors de `emit`, l'entrée part tout de suite. `clearEngineContacts` et `stop()` vident les listes tout de suite, même pendant un parcours. `ContactRegistry.removeEntity` retire chaque entrée de cette entité. `SensorRegistry.remove` retire chaque entrée dont le callback est dans la liste. Un `remove` vide ne retire rien.

## Module

`definePhysicsModule` construit un module à partir d'une `PhysicsModuleDefinition`. Son `setup` enregistre la déclaration du plugin avec les options résolues, copie les auto-imports dans l'ordre donné, et ajoute le plugin Vite construit depuis ces options. `defaults` et `validate` restent les objets passés par l'appelant. Un nom vide est rejeté avec le code `KIT:MODULE_INVALID`.

## Plugin

`createPhysicsPlugin` construit un plugin à partir d'un `PhysicsAdapter`. `setup` range `api` sous la clé de service et route `prefab:instantiate`, `entity:destroy`, `engine:before-update` et `engine:update` vers cet adaptateur. `beginFrame`, quand l'adaptateur en a un, tourne à chaque `engine:before-update`. `step` ne tourne que lorsque `dt > 0`. À chaque `engine:update`, le plugin lit `eventView`. Sans vue, ou avec un compte de 0, il n'émet rien. Sinon les transitions de capteur passent d'abord. Dans une transition, `onSensorEnter` ou `onSensorExit` part, puis le hook `physics:sensor:changed`. Quand la liste de contacts résolus est vide, le plugin n'appelle ni `physics:collision`, ni `onContact`, ni `onContacts`. Les transitions de capteur de cette frame partent quand même. Quand la liste n'est pas vide, l'ordre continue avec le hook `physics:collision`, les callbacks `onContact`, puis `onContacts`. Une entrée ne part que lorsqu'une entité et un capteur passent de 0 chevauchement à 1. Une sortie ne part que de 1 à 0. Le compte ne descend pas sous 0. Un id que `resolveSensorId` refuse ne change pas ce capteur. Détruire une entité oublie les comptes de capteur de cette entité. Aucune sortie et aucun `physics:sensor:changed` ne part pour elle. Un handler `physics:collision` rejeté est publié sur le bus d'erreurs du moteur, code `CORE:PLUGIN_RUNTIME_ERROR`, source le nom du plugin. `makeAdapter` reçoit le `PhysicsSensorTracker` de ce plugin. `read` et `update` partagent les comptes du dispatch. `update` n'émet rien. `teardown` vide les callbacks de contact et de capteur de ce moteur, puis appelle `dispose`. Un second `teardown` ne vide pas les callbacks inscrits après le premier, et n'appelle pas `dispose` une seconde fois. Une exception de la fabrique d'adaptateur est l'erreur rejetée par `engine.use`.
