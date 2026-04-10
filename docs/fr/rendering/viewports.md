---
title: Viewports
description: Divisez l'écran en régions nommées — plein écran, split-screen, minimap, 4 joueurs — et associez une caméra à chacune.
---

# Viewports

Un **viewport** est une région nommée et normalisée de l'écran. GWEN utilise les viewports pour diviser la surface de rendu en cibles indépendantes — une caméra par viewport, chacune avec son propre transform et sa propre projection.

Toutes les coordonnées sont normalisées entre `[0–1]`, où `(0, 0)` est le coin supérieur gauche et `(1, 1)` le coin inférieur droit.

```
┌───────────────────────┐
│  x: 0  y: 0           │
│  width: 1  height: 1  │   ← plein écran
└───────────────────────┘

┌───────────┬───────────┐
│  p1       │  p2       │   ← split-screen
│  w: 0.5   │  x: 0.5   │
└───────────┴───────────┘
```

## Déclaration statique — `gwen.config.ts`

Déclarez vos viewports une fois dans `gwen.config.ts`. GWEN les enregistre au démarrage du moteur, avant tout plugin caméra ou renderer.

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/camera2d', '@gwenjs/renderer-html'],
  viewports: {
    main: { x: 0, y: 0, width: 1, height: 1 },
  },
})
```

::: tip Viewport par défaut
Si vous omettez la clé `viewports`, GWEN crée automatiquement un viewport plein écran nommé `'main'`. Vous n'avez besoin de les déclarer explicitement que si vous en voulez plusieurs.
:::

## Mises en page courantes

### Split-screen (2 joueurs)

```ts
export default defineConfig({
  viewports: {
    p1: { x: 0,   y: 0, width: 0.5, height: 1 },
    p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
  },
})
```

### Grille 4 joueurs

```ts
export default defineConfig({
  viewports: {
    p1: { x: 0,   y: 0,   width: 0.5, height: 0.5 },
    p2: { x: 0.5, y: 0,   width: 0.5, height: 0.5 },
    p3: { x: 0,   y: 0.5, width: 0.5, height: 0.5 },
    p4: { x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  },
})
```

### Vue principale + minimap

```ts
export default defineConfig({
  viewports: {
    main:    { x: 0,    y: 0,    width: 1,    height: 1    },
    minimap: { x: 0.75, y: 0.75, width: 0.25, height: 0.25 },
  },
})
```

## Viewports dynamiques — `useViewportManager()`

Pour les mises en page qui changent en cours de jeu — un joueur rejoint la partie, une minimap s'affiche — utilisez `useViewportManager()` dans un système ou un acteur.

```ts
import { useViewportManager } from '@gwenjs/renderer-core'
import { defineSystem, onUpdate } from '@gwenjs/core/system'

export const LayoutSystem = defineSystem('LayoutSystem', () => {
  const viewports = useViewportManager()

  onUpdate(() => {
    if (joueur2Rejoint) {
      // Passage du plein écran au split-screen
      viewports.set('p1', { x: 0,   y: 0, width: 0.5, height: 1 })
      viewports.set('p2', { x: 0.5, y: 0, width: 0.5, height: 1 })
      viewports.remove('main')
    }
  })
})
```

::: warning Ordre d'appel
`useViewportManager()` doit être appelé dans la **phase setup** d'un système ou acteur (en dehors de `onUpdate`). La référence retournée est stable — vous pouvez appeler `.set()` / `.remove()` depuis n'importe où.
:::

### API

| Méthode | Description |
|---|---|
| `set(id, region)` | Enregistre ou redimensionne un viewport. Émet `viewport:add` au premier appel, `viewport:resize` lors d'une mise à jour. |
| `remove(id)` | Supprime un viewport. Émet `viewport:remove`. Sans effet si l'id est inconnu. |
| `get(id)` | Retourne le `ViewportContext` pour cet id, ou `undefined`. |
| `getAll()` | Map en lecture seule de tous les viewports enregistrés. Ne pas muter. |

## Réagir aux changements de viewport

Tout plugin ou système peut s'abonner aux hooks de cycle de vie des viewports :

```ts
import { useEngine } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const ViewportListenerSystem = defineSystem('ViewportListenerSystem', () => {
  const engine = useEngine()

  engine.hooks.hook('viewport:add', ({ id, region }) => {
    console.log(`viewport "${id}" ajouté`, region)
  })

  engine.hooks.hook('viewport:resize', ({ id, region }) => {
    console.log(`viewport "${id}" redimensionné`, region)
  })

  engine.hooks.hook('viewport:remove', ({ id }) => {
    console.log(`viewport "${id}" supprimé`)
  })
})
```

| Hook | Payload | Quand |
|---|---|---|
| `viewport:add` | `{ id, region }` | Un nouveau viewport est enregistré |
| `viewport:resize` | `{ id, region }` | La région d'un viewport existant change |
| `viewport:remove` | `{ id }` | Un viewport est supprimé |

## Associer une caméra à un viewport

Un viewport est simplement une région d'écran — il n'a pas de caméra par lui-même. Associez une entité caméra à un viewport via `cameraViewportMap` depuis `@gwenjs/camera-core` :

```ts
import { Camera, cameraViewportMap } from '@gwenjs/camera-core'
import { useEngine } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const CameraSetupSystem = defineSystem('CameraSetupSystem', () => {
  const engine = useEngine()

  const camId = engine.createEntity()
  engine.addComponent(camId, Camera, {
    active: 1,
    priority: 0,
    projectionType: 0, // orthographique
    x: 0, y: 0, z: 0,
    rotX: 0, rotY: 0, rotZ: 0,
    zoom: 1,
    fov: Math.PI / 3,
    near: -1000,
    far: 1000,
  })

  // Associe la caméra au viewport 'main'
  cameraViewportMap.set(camId, 'main')
})
```

::: tip camera2d / camera3d
Avec `@gwenjs/camera2d` ou `@gwenjs/camera3d`, les composables `use2DCamera()` / `use3DCamera()` gèrent la création de l'entité et l'association au viewport à votre place. L'approche bas niveau ci-dessus n'est nécessaire que pour construire une logique caméra personnalisée.
:::

## Aller plus loin

- **[API `@gwenjs/camera-core`](/fr/api/camera-core)** — Composants ECS, pipeline CameraSystem et codes d'erreur.
- **[API `@gwenjs/renderer-core`](/fr/api/renderer-core)** — Référence ViewportManager, CameraManager et LayerDef.
- **[Créer un renderer personnalisé](/fr/kit/custom-renderer)** — Intégrer ViewportManager dans votre plugin renderer.
