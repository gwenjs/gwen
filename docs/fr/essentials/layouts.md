---
title: Layouts
description: Couches d'UI persistantes qui survivent aux transitions de scènes — idéales pour les HUD, barres de menus et l'UI globale.
---

# Layouts

Un **layout** est une couche persistante qui vit au-dessus de toutes les scènes. Contrairement aux scènes (qui se chargent et se déchargent), un layout persiste lors des transitions de scènes. Utilisez les layouts pour les HUD, les barres de menu, les boîtes de dialogue de pause et toute UI qui devrait survivre lorsque vous changez de scènes.

::: info Auto-imports
Dans un projet GWEN, `defineLayout`, `useLayout`, `placeActor`, `placeGroup` et `placePrefab` sont auto-importés — aucune ligne `import` nécessaire.
:::

## Les bases

Utilisez `defineLayout()` pour déclarer une couche persistante. À l'intérieur de la factory, placez des acteurs en utilisant `placeActor()` :

```ts
import { HUDActor } from './actors/hud'
import { MinimapActor } from './actors/minimap'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  const minimap = placeActor(MinimapActor)
  return { hud, minimap }
})
```

L'objet retourné devient `layout.refs` — les handles pour chaque acteur placé.

## Charger et décharger

Utilisez `useLayout(def)` à l'intérieur d'une scène pour obtenir un handle de contrôle :

```ts
export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout)

  onEnter(() => layout.load())
  onExit(() => layout.dispose())
})
```

API `LayoutHandle` :

| | |
|---|---|
| `layout.load()` | Activer le layout — spawn tous les acteurs placés |
| `layout.dispose()` | Désactiver — despawn tous les acteurs placés |
| `layout.active` | `true` si le layout est chargé |
| `layout.refs` | Objet avec le handle de chaque acteur placé |

## Groupes et prefabs

Utilisez `placeGroup()` pour créer une entité d'ancrage de transform uniquement — utile comme conteneur parent que vous pouvez positionner ou faire pivoter pour déplacer plusieurs enfants ensemble :

```ts
export const GameLayout = defineLayout(() => {
  const group = placeGroup({ at: [200, 0] })
  return { group }
})
```

Pour placer plusieurs acteurs, appelez simplement `placeActor()` pour chacun :

```ts
export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  const minimap = placeActor(MinimapActor)
  const chat = placeActor(ChatActor)
  return { hud, minimap, chat }
})
```

Utilisez `placePrefab()` pour placer une entité prefab (pas un acteur) dans le layout :

```ts
export const GameLayout = defineLayout(() => {
  const cursor = placePrefab(CursorPrefab)
  return { cursor }
})
```

## Accéder aux acteurs placés

`layout.refs` expose les handles retournés par `placeActor()` :

```ts
const layout = useLayout(GameLayout)

// Accéder au handle de l'acteur HUD
const hud = layout.refs.hud

// Appeler des méthodes sur le HUD
hud.get()?.updateScore(100)
```

## Exemple de HUD

Un HUD réaliste qui reste actif lors des transitions de scènes :

```ts
// src/actors/hud.ts
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'

export const HUDActor = defineActor(HUDPrefab, () => {
  const data = useComponent(HUDData)

  onUpdate(() => {
    renderHUD({
      score: data.score,
      health: data.health,
    })
  })

  return {
    setScore: (n: number) => { data.score = n },
    setHealth: (n: number) => { data.health = n },
  }
})

// src/layouts/game-layout.ts
import { HUDActor } from '../actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  return { hud }
})

// À partir du système de n'importe quelle scène — mettez à jour le HUD :
const layout = useLayout(GameLayout)
layout.refs.hud.get()?.setScore(newScore)
```

## Layout vs Scène

| | Layout | Scène |
|---|---|---|
| **Persistance** | Survit aux transitions de scènes | Se charge/décharge par scène |
| **Systèmes** | — | S'exécutent pendant que la scène est active |
| **Acteurs** | Placés via `placeActor` | Enregistrés via `useActor` |
| **Cas d'usage** | HUD, barres de menu, UI globale | États du jeu, logique de niveau |

## Résumé de l'API

| | |
|---|---|
| `defineLayout(factory)` | Déclarer une couche d'UI persistante |
| `placeActor(def)` | Placer un acteur dans le layout → handle dans `refs` |
| `placeGroup(options?)` | Créer une entité d'ancrage de transform uniquement |
| `placePrefab(def)` | Placer une entité prefab dans le layout |
| `useLayout(def)` | Obtenir le handle de contrôle du layout |
| `layout.load()` | Activer le layout |
| `layout.dispose()` | Désactiver le layout |
| `layout.active` | `true` si le layout est chargé |
| `layout.refs` | Objet avec les handles des acteurs placés |

## Étapes suivantes

- **[Scènes](/fr/essentials/scenes)** — Comment les scènes fonctionnent avec les layouts.
- **[Acteurs](/fr/essentials/actors)** — Construire les acteurs d'UI placés dans votre layout.
- **[Prefabs](/fr/essentials/prefabs)** — Placer des entités prefab dans les layouts.
