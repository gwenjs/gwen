---
title: '@gwenjs/camera-core'
description: Système de caméra ECS — composants, pipeline CameraSystem, stores annexes et hooks moteur.
---

# `@gwenjs/camera-core`

Système de caméra ECS bas niveau partagé par `@gwenjs/camera2d` et `@gwenjs/camera3d`. Fournit
les composants, l'orchestrateur `CameraSystem`, les stores annexes et `CameraCorePlugin`.

> **Note** — Ce package ne s'installe normalement pas directement. Utilisez `@gwenjs/camera2d` ou
> `@gwenjs/camera3d` à la place — ils enregistrent `CameraCorePlugin` automatiquement.

```bash
pnpm add @gwenjs/camera-core
```

## Démarrage rapide

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'
import { defineSystem } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'
import { useViewportManager } from '@gwenjs/renderer-core'
import { CameraCorePlugin, Camera, cameraViewportMap } from '@gwenjs/camera-core'

const CameraSetupSystem = defineSystem('CameraSetupSystem', () => {
  const engine = useEngine()
  const viewports = useViewportManager()

  viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })

  const camId = engine.createEntity()
  engine.addComponent(camId, Camera, {
    active: 1,
    priority: 0,
    projectionType: 0,
    x: 0, y: 0, z: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    zoom: 1,
    fov: Math.PI / 3,
    near: -1000,
    far: 1000,
  })
  cameraViewportMap.set(camId, 'main')
})

export default defineConfig({
  plugins: [CameraCorePlugin(), CameraSetupSystem],
})
```

## Composants ECS

| Composant | Rôle |
|---|---|
| `Camera` | État principal — position, rotation, projection, flag actif, priorité |
| `FollowTarget` | Lerpe la caméra vers la position d'une autre entité à chaque frame |
| `CameraBounds` | Contraint la position de la caméra dans une boîte englobante |
| `CameraShake` | Tremblement d'écran basé sur le trauma — décale la position rendue sans modifier `Camera.x/y/z` |
| `CameraPath` | Marque-page pour l'état de suivi de chemin (index du waypoint courant + progression) |

### Champs de `Camera`

```ts
{
  active: 0 | 1         // 0 = inactif, 1 = actif
  priority: number      // la priorité la plus haute remporte le slot viewport
  projectionType: 0 | 1 // 0 = orthographique, 1 = perspective
  x, y, z: number       // position monde
  rotX, rotY, rotZ: number // rotation Euler (radians)
  zoom: number          // facteur de zoom orthographique
  fov: number           // champ de vision perspective (radians)
  near, far: number     // plans de découpe
}
```

### Champs de `FollowTarget`

```ts
{
  entityId: bigint      // entité cible (EntityId / u64)
  lerp: number          // facteur d'interpolation par frame [0–1]
  offsetX, offsetY, offsetZ: number
}
```

### Champs de `CameraBounds`

```ts
{ minX, minY, minZ, maxX, maxY, maxZ: number }
```

### Champs de `CameraShake`

```ts
{
  trauma: number  // trauma courant [0–1] — incrémenter pour déclencher le tremblement
  decay: number   // trauma perdu par seconde
  maxX: number    // décalage horizontal maximum en unités monde
  maxY: number    // décalage vertical maximum en unités monde
}
```

## Stores annexes

`cameraViewportMap` et `cameraPathStore` sont des `Map` au niveau module qui coexistent avec
les composants ECS, car les chaînes et objets complexes ne peuvent pas être stockés dans les
buffers SoA.

```ts
import { cameraViewportMap, cameraPathStore } from '@gwenjs/camera-core'
import type { CameraPathData } from '@gwenjs/camera-core'

// Associer une caméra à un viewport
cameraViewportMap.set(camId, 'main')

// Démarrer un chemin
const pathData: CameraPathData = {
  waypoints: [
    { position: { x: 200, y: 0, z: 0 }, duration: 1.5, easing: 'easeInOut' },
    { position: { x: 200, y: 300, z: 0 }, duration: 1.0 },
  ],
  opts: { loop: false, onComplete: () => console.log('terminé') },
  elapsed: 0,
}
engine.addComponent(camId, CameraPath, { index: 0, progress: 0 })
cameraPathStore.set(camId, pathData)
```

## Hooks moteur

`CameraSystem` émet ces hooks via `engine.hooks` lorsque la caméra active change sur un viewport :

| Hook | Payload | Quand |
|---|---|---|
| `camera:activate` | `{ viewportId: string, entityId: EntityId }` | Première fois qu'une caméra devient active sur un viewport |
| `camera:deactivate` | `{ viewportId: string }` | La caméra active est désactivée sans remplacement |
| `camera:switch` | `{ viewportId: string, from: EntityId, to: EntityId }` | La caméra active change d'une entité à une autre |

```ts
engine.hooks.hook('camera:activate', ({ viewportId, entityId }) => {
  console.log(`caméra ${entityId} active sur ${viewportId}`)
})
```

Les hooks `viewport:*` (`viewport:add`, `viewport:resize`, `viewport:remove`) sont déclarés dans
`@gwenjs/renderer-core`.

## Pipeline `CameraSystem`

À chaque frame, `CameraSystem` exécute les étapes suivantes :

1. `CameraManager.clearFrame()` — les états périmés sont écartés
2. Pour chaque entité avec `Camera.active = 1` :
   - Application du lerp `FollowTarget` vers l'entité cible — **ou** avancement des waypoints `CameraPath`
   - Contrainte aux `CameraBounds`
   - Calcul du décalage `CameraShake` (ne modifie **pas** `Camera.x/y/z`)
   - Push du `CameraState` vers `CameraManager`
3. Détection des changements sémantiques par viewport et émission de `camera:activate / deactivate / switch`

## Multi-caméra / priorité

Plusieurs caméras peuvent cibler le même viewport. Celle avec la `Camera.priority` la plus haute
l'emporte. À priorité égale, la dernière entité ayant poussé son état gagne.

## Construire un handle de caméra personnalisé

```ts
import { CameraCorePlugin, Camera, cameraViewportMap } from '@gwenjs/camera-core'
import { useCameraManager } from '@gwenjs/renderer-core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

const MyRenderSystem = defineSystem('MyRenderSystem', () => {
  const cameras = useCameraManager()
  onUpdate(() => {
    const state = cameras.get('main')
    if (state) {
      const { x, y, z } = state.worldTransform.position
      // appliquer à votre renderer
    }
  })
})
```

## Codes d'erreur

```ts
const CameraErrorCodes = {
  VIEWPORT_NOT_FOUND:   'CAMERA:VIEWPORT_NOT_FOUND',
  EMPTY_PATH:           'CAMERA:EMPTY_PATH',
  PERSPECTIVE_FALLBACK: 'CAMERA:PERSPECTIVE_FALLBACK', // warn uniquement, jamais levé
  PRIORITY_CONFLICT:    'CAMERA:PRIORITY_CONFLICT',    // warn uniquement, jamais levé
}
```
