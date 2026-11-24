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

`onContact`, `onSensorEnter` et `onSensorExit` utilisent le moteur courant. Hors de ce contexte, ils lèvent `GwenContextError` avec le code `CORE:OUTSIDE_ENGINE_CONTEXT`. La liste d'un moteur disparaît avec son `stop()`. Un retrait pendant `emit` attend la fin du `emit` le plus extérieur, et l'entrée reste dans la liste pendant ce parcours. Hors de `emit`, l'entrée part tout de suite. `clearEngineContacts` et `stop()` vident les listes tout de suite, même pendant un parcours. `ContactRegistry.removeEntity` retire chaque entrée de cette entité. `SensorRegistry.remove` retire chaque entrée dont le callback est dans la liste. Un `remove` vide ne retire rien. `onSensorEnter` et `onSensorExit` prennent un `ownerEntityId` optionnel. Quand il est passé, le callback ne part que pour cette entité. Quand il est omis, le callback part pour chaque entité. `emit` garde l'ordre d'inscription et ignore un propriétaire qui n'est pas l'entité de l'événement. `SensorRegistry.removeOwned(entityId, sensorId?)` retire les callbacks de ce propriétaire. Un `sensorId` ne retire que ce capteur. Un second appel ne retire rien. Pendant `emit`, le retrait attend la fin du `emit` le plus extérieur.

## Module

`definePhysicsModule` construit un module à partir d'une `PhysicsModuleDefinition`. Son `setup` enregistre la déclaration du plugin avec les options résolues, copie les auto-imports dans l'ordre donné, et ajoute le plugin Vite construit depuis ces options. `defaults` et `validate` restent les objets passés par l'appelant. Un nom vide est rejeté avec le code `KIT:MODULE_INVALID`.

## Plugin

`createPhysicsPlugin` construit un plugin à partir d'un `PhysicsAdapter`. `setup` range `api` sous la clé de service et route `prefab:instantiate`, `entity:destroy`, `engine:before-update` et `engine:update` vers cet adaptateur. `beginFrame`, quand l'adaptateur en a un, tourne à chaque `engine:before-update`. `step` ne tourne que lorsque `dt > 0`. À chaque `engine:update`, le plugin lit `eventView`. Sans vue, ou avec un compte de 0, il n'émet rien. Sinon les transitions de capteur passent d'abord. Dans une transition, `onSensorEnter` ou `onSensorExit` part, puis le hook `physics:sensor:changed`. Quand la liste de contacts résolus est vide, le plugin n'appelle ni `physics:collision`, ni `onContact`, ni `onContacts`. Les transitions de capteur de cette frame partent quand même. Quand la liste n'est pas vide, l'ordre continue avec le hook `physics:collision`, les callbacks `onContact`, puis `onContacts`. Une entrée part quand `isActive` passe de faux à vrai. Une sortie part quand il passe de vrai à faux. `update` et le dispatch avancent le compte stocké et posent `isActive` à `count > 0`. Le compte ne descend pas sous 0. Un id que `resolveSensorId` refuse ne change pas ce capteur. Détruire une entité oublie les comptes de capteur de cette entité. Elle retire aussi les callbacks de capteur de ce propriétaire (`SensorRegistry.removeOwned`). Aucune sortie et aucun `physics:sensor:changed` ne part pour elle. Un handler `physics:collision` rejeté est publié sur le bus d'erreurs du moteur, code `CORE:PLUGIN_RUNTIME_ERROR`, source le nom du plugin. `makeAdapter` reçoit le `PhysicsSensorTracker` de ce plugin. `set` range `contactCount` et `isActive` tels quels, y compris `isActive: true` avec `contactCount: 0` et `isActive: false` avec un compte au-dessus de 0. `read` renvoie cette paire. `update` avance le même compte que le dispatch et n'émet rien. `set` n'émet rien. `teardown` vide les callbacks de contact et de capteur de ce moteur, puis appelle `dispose`. Un second `teardown` ne vide pas les callbacks inscrits après le premier, et n'appelle pas `dispose` une seconde fois. Une exception de la fabrique d'adaptateur est l'erreur rejetée par `engine.use`.
