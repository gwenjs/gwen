---
title: Caméras
description: Caméras basées sur des acteurs avec projections orthographique et perspective, shake et bounds.
---

# Caméras

Une **caméra** dans GWEN est un acteur. Elle possède une entité ECS, un cycle de vie, et est déclarée dans une scène comme n'importe quel autre acteur. Le composable `useCamera()` est appelé dans `defineActor()` pour configurer la caméra et obtenir un handle typé.

::: info Auto-imports
`useCamera`, `OrthographicCameraPrefab` et `PerspectiveCameraPrefab` sont auto-importés dans un projet GWEN. Le plugin doit être installé au préalable :

```ts
import { CameraCorePlugin } from '@gwenjs/camera-core'
```
:::

## Les deux projections

| Prefab | Projection | Handle |
|---|---|---|
| `OrthographicCameraPrefab` | 2D, basée sur le zoom | `Camera2DHandle` |
| `PerspectiveCameraPrefab` | 3D, basée sur le fov | `Camera3DHandle` |

## Définir un acteur caméra

`useCamera()` doit être appelé dans une factory `defineActor()`. Utilisez le prefab correspondant.

```ts
import { OrthographicCameraPrefab } from '@gwenjs/camera-core'

export const GameCameraActor = defineActor(OrthographicCameraPrefab, () => {
  const cam = useCamera({ projection: 'orthographic', viewport: 'main', zoom: 1.5 })

  onStart(() => {
    cam.setPosition(0, 0)
    cam.setBounds({ minX: 0, maxX: 4000, minY: 0, maxY: 2000 })
  })
})
```

```ts
import { PerspectiveCameraPrefab } from '@gwenjs/camera-core'

export const SceneCameraActor = defineActor(PerspectiveCameraPrefab, () => {
  const cam = useCamera({ projection: 'perspective', viewport: 'main', fov: Math.PI / 3 })

  onStart(() => {
    cam.setPosition(0, 5, 10)
    cam.setRotation(-0.4, 0, 0)
  })
})
```

## Déclarer dans une scène

```ts
export const GameScene = defineScene('game', () => {
  const camera = useActor(GameCameraActor)

  onEnter(() => camera.spawn())
  onExit(() => camera.despawnAll())
})
```

## Options de useCamera

### Camera2DOpts

| Option | Type | Défaut | Description |
|---|---|---|---|
| `projection` | `'orthographic'` | requis | Sélectionne la projection orthographique. |
| `viewport` | `string` | `'main'` | Viewport cible. |
| `priority` | `number` | `0` | La valeur la plus haute gagne quand plusieurs caméras ciblent le même viewport. |
| `zoom` | `number` | `1` | Facteur de zoom. Au-dessus de 1 = zoom avant, en-dessous = zoom arrière. |
| `near` | `number` | `0.1` | Plan de clipping proche. |
| `far` | `number` | `1000` | Plan de clipping lointain. |

### Camera3DOpts

| Option | Type | Défaut | Description |
|---|---|---|---|
| `projection` | `'perspective'` | requis | Sélectionne la projection perspective. |
| `viewport` | `string` | `'main'` | Viewport cible. |
| `priority` | `number` | `0` | La valeur la plus haute gagne quand plusieurs caméras ciblent le même viewport. |
| `fov` | `number` | `Math.PI / 3` | Champ de vision vertical en radians (60° par défaut). |
| `near` | `number` | `0.1` | Plan de clipping proche. |
| `far` | `number` | `1000` | Plan de clipping lointain. |

## API Camera2DHandle

```ts
const cam = useCamera({ projection: 'orthographic' })

cam.setPosition(x, y)       // déplacer vers une position monde
cam.setZoom(zoom)           // définir le facteur de zoom
cam.getZoom()               // lire le zoom actuel
cam.setViewport('hud')      // réassigner à un autre viewport
cam.getViewport()           // lire l'id du viewport actuel
cam.setPriority(10)         // modifier la priorité de rendu
cam.setActive(false)        // désactiver — la caméra est ignorée par CameraSystem
cam.setBounds({ minX: 0, maxX: 2000, minY: 0, maxY: 1000 })
cam.clearBounds()           // supprimer les bornes — la caméra se déplace librement
cam.shake(0.6)              // appliquer un screen shake basé sur le trauma
```

## API Camera3DHandle

```ts
const cam = useCamera({ projection: 'perspective' })

cam.setPosition(x, y, z)        // déplacer vers une position monde
cam.setRotation(rx, ry, rz)     // définir la rotation euler (radians)
cam.setFov(Math.PI / 2)         // définir le champ de vision vertical
cam.getFov()                    // lire le fov actuel
cam.setViewport('main')
cam.getViewport()
cam.setPriority(5)
cam.setActive(false)
cam.setBounds({ minX: -100, maxX: 100, minZ: -50, maxZ: 50 })
cam.clearBounds()
cam.shake(0.4)
```

## Screen Shake

`shake(intensity)` applique un shake basé sur le trauma. `intensity` est limité à `[0, 1]`. Le handle retourné permet d'ajouter du trauma depuis n'importe où.

```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  const camera = useActor(GameCameraActor)

  return {
    onHit() {
      const shakeHandle = camera.get()?.shake(0.5)
      // ajouter du trauma plus tard
      shakeHandle?.trauma(0.2)
    },
  }
})
```

Options du shake :

```ts
cam.shake(0.6, {
  decay: 2,                         // taux de décroissance du trauma par seconde (défaut 1)
  maxOffset: { x: 40, y: 40 },     // décalage maximum en pixels (orthographique)
})
```

## Bornes

`setBounds` contraint la position de la caméra à un rectangle en coordonnées monde. Utile pour éviter d'afficher les zones hors de la carte.

```ts
// 2D — limiter aux bords de la carte
cam.setBounds({ minX: 0, maxX: 4000, minY: 0, maxY: 2000 })

// 3D — limiter sur tous les axes
cam.setBounds({ minX: -50, maxX: 50, minY: 0, maxY: 20, minZ: -50, maxZ: 50 })

// Supprimer les bornes
cam.clearBounds()
```

Les axes non spécifiés valent `±Infinity` par défaut.

## Plusieurs caméras et priorité

Plusieurs caméras peuvent cibler le même viewport — celle avec la `priority` la plus haute gagne à chaque frame. À priorité égale, le dernier à écrire gagne.

```ts
// Caméra de jeu principale
const mainCam = useCamera({ projection: 'orthographic', viewport: 'main', priority: 0 })

// Caméra de cinématique — priorité plus haute, prend le dessus quand elle est spawnée
const cutsceneCam = useCamera({ projection: 'orthographic', viewport: 'main', priority: 10 })
```

## Attribution du viewport

Une caméra cible un seul viewport par son nom. Réassignez à l'exécution avec `setViewport()`.

```ts
cam.setViewport('minimap')
```

Les régions de viewport sont déclarées dans `gwen.config.ts` :

```ts
export default defineConfig({
  viewports: {
    main:    { x: 0, y: 0, width: 1,    height: 1 },
    minimap: { x: 0.75, y: 0, width: 0.25, height: 0.25 },
  },
})
```

## Construire une caméra personnalisée

N'importe quel plugin ou module peut construire son propre composable caméra en utilisant directement l'API bas niveau de `camera-core`. La seule contrainte : appeler `useCamera()` dans `defineActor()` avec un prefab qui inclut `Camera`, `CameraBounds` et `CameraShake`.

```ts
import { defineActor } from '@gwenjs/core/actor'
import { OrthographicCameraPrefab, useCamera } from '@gwenjs/camera-core'

export const TopDownCameraActor = defineActor(OrthographicCameraPrefab, (props: { target: EntityId }) => {
  const cam = useCamera({ projection: 'orthographic', viewport: 'main' })

  // suivre props.target à chaque frame
  onUpdate(() => {
    // ... lire la position de la cible et appeler cam.setPosition(...)
  })
})
```

## Caméras WebXR

Pour les applications WebXR (VR/AR), utilisez `useXRCamera()` à la place de `useCamera()`. Une seule caméra logique représente le casque (le viewer). Le plugin XR renderer pilote le rendu par œil en interne en appelant `_setViews()` à chaque frame avec les données de `XRViewerPose.views` — vous ne gérez jamais directement les yeux gauche/droit.

`CameraSystem` ignore entièrement les caméras XR (`projectionType === 2`). Le plugin XR renderer met à jour `CameraManager` directement.

### Définir un acteur caméra XR

```ts
import { XRCameraPrefab, useXRCamera } from '@gwenjs/camera-core'

export const XRViewerActor = defineActor(XRCameraPrefab, () => {
  const cam = useXRCamera({ viewport: 'main', priority: 0 })

  onUpdate(() => {
    const head = cam.getHeadPosition()
    if (head) updateHUDPosition(head.x, head.y, head.z)
  })

  // Exposer _setViews pour que le plugin XR renderer pilote la caméra à chaque frame.
  return { cam }
})
```

### XRCameraOpts

| Option | Type | Défaut | Description |
|---|---|---|---|
| `viewport` | `string` | `'main'` | Viewport cible. |
| `priority` | `number` | `0` | Priorité de rendu. |

### API XRCameraHandle

```ts
cam.setViewport('main')       // réassigner à un autre viewport
cam.getViewport()             // lire l'id du viewport actuel
cam.setPriority(10)           // modifier la priorité de rendu
cam.setActive(false)          // désactiver la caméra
cam.getHeadPosition()         // position monde de la tête dérivée de la matrice de vue, ou undefined
cam._setViews(views)          // appelé par le plugin XR renderer à chaque frame — ne pas appeler manuellement
```

`getHeadPosition()` dérive la position monde de la caméra depuis la première matrice de vue via la formule column-major `p = -Rᵀ · t`. Retourne `undefined` jusqu'au premier appel à `_setViews()`.

::: info Acteur uniquement
`useXRCamera()` nécessite un contexte `defineActor()` (même contrainte que `useCamera()`). Il utilise `useEntityId()` et `useComponent()` en interne.
:::

## Résumé de l'API

| | |
|---|---|
| `OrthographicCameraPrefab` | Prefab pour caméras 2D — inclut `Camera`, `CameraBounds`, `CameraShake` |
| `PerspectiveCameraPrefab` | Prefab pour caméras 3D — inclut `Camera`, `CameraBounds`, `CameraShake` |
| `useCamera(opts)` | Composable acteur — retourne `Camera2DHandle` ou `Camera3DHandle` |
| `cam.setPosition(x, y)` | Déplacer la caméra (2D) |
| `cam.setPosition(x, y, z)` | Déplacer la caméra (3D) |
| `cam.setZoom(zoom)` | Définir le facteur de zoom (2D uniquement) |
| `cam.setFov(fov)` | Définir le champ de vision en radians (3D uniquement) |
| `cam.setRotation(rx, ry, rz)` | Définir la rotation euler (3D uniquement) |
| `cam.setViewport(id)` | Réassigner au viewport |
| `cam.setPriority(n)` | Modifier la priorité de rendu |
| `cam.setActive(bool)` | Activer ou désactiver la caméra |
| `cam.setBounds(opts)` | Contraindre la position |
| `cam.clearBounds()` | Supprimer la contrainte de position |
| `cam.shake(intensity, opts?)` | Appliquer un screen shake, retourne un `ShakeHandle` |

| `XRCameraPrefab` | Prefab pour caméras WebXR — inclut `Camera` avec `projectionType: 2` |
| `useXRCamera(opts?)` | Composable acteur — retourne `XRCameraHandle` |
| `cam.getHeadPosition()` | Position monde de la tête dérivée de la matrice de vue |
| `cam._setViews(views)` | Appelé par le plugin XR renderer à chaque frame |

## Prochaines étapes

- **[Acteurs](/fr/essentials/actors)** — Comment fonctionnent les acteurs dans GWEN.
- **[Prefabs](/fr/essentials/prefabs)** — Définir la disposition des composants pour les acteurs.
- **[Scènes](/fr/essentials/scenes)** — Déclarer et contrôler les acteurs depuis une scène.
