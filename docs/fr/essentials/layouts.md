---
title: Layouts
description: Couches d'UI persistantes qui survivent aux transitions de scènes — idéales pour les HUD, barres de menus et l'UI globale.
---

# Layouts

Un **layout** est une couche persistante qui vit au-dessus de toutes les scènes. Contrairement aux scènes (qui se chargent et se déchargent), un layout persiste lors des transitions de scènes. Utilisez les layouts pour les HUD, les barres de menu, les boîtes de dialogue de pause et toute UI qui devrait survivre lorsque vous changez de scènes.

::: info Auto-imports
Dans un projet GWEN, `defineLayout`, `useLayout`, `placeActor`, `placeGroup` et `placePrefab` sont auto-importés — aucune ligne `import` nécessaire.
:::

## Définir un layout

Utilisez `defineLayout()` pour déclarer une couche persistante. Dans la factory, placez des acteurs avec `placeActor()` en indiquant leur position initiale et leurs props :

```ts
import { HUDActor } from './actors/hud'
import { MinimapActor } from './actors/minimap'

export const GameLayout = defineLayout(() => {
  const hud     = placeActor(HUDActor,     { at: [0, 0] })
  const minimap = placeActor(MinimapActor, { at: [700, 16] })
  return { hud, minimap }
})
```

L'objet retourné par la factory devient `layout.refs` — un record typé de valeurs `PlaceHandle`, une par acteur placé.

## PlaceHandle

`placeActor()` retourne un `PlaceHandle` avec un accès direct à l'entité placée :

| Propriété / Méthode | Description |
|---|---|
| `handle.api` | L'API publique de l'acteur (valeur de retour de la factory d'acteur) |
| `handle.entityId` | L'ID `bigint` de l'entité |
| `handle.moveTo([x, y])` | Repositionner l'entité en espace monde |
| `handle.despawn()` | Despawner cette entité immédiatement |

```ts
const layout = useLayout(GameLayout, { lazy: true })
await layout.load()

// Appeler une méthode sur l'acteur HUD
layout.refs.hud.api.setScore(100)

// Déplacer la minimap
layout.refs.minimap.moveTo([680, 16])
```

## Options de placement

Tous les composables `place*` acceptent un second argument avec des options de placement :

| Option | Type | Description |
|---|---|---|
| `at` | `[x, y]` | Position locale. Défaut `[0, 0]` |
| `rotation` | `number` | Rotation locale en radians. Défaut `0` |
| `scale` | `number \| [sx, sy]` | Échelle uniforme ou par axe. Défaut `1` |
| `parent` | `PlaceHandle` | Handle parent — la position est relative au parent |
| `props` | `object` | Props transmises à l'acteur au moment du spawn |

```ts
export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, {
    at: [0, 0],
    props: { initialScore: 0 },
  })

  // Groupe d'ancrage — les enfants héritent de sa transform
  const topBar = placeGroup({ at: [0, 0] })
  const timer  = placeActor(TimerActor, { at: [400, 8], parent: topBar })

  return { hud, topBar, timer }
})
```

## Layouts et cycle de vie des scènes

La factory `defineScene` s'exécute **une seule fois au bootstrap** — pas à chaque navigation. `useLayout` appelé dans la factory crée le handle et le capture dans une closure, mais ne charge pas encore le layout. `onEnter` et `onExit` s'exécutent à chaque navigation et c'est là que vous chargez et disposez :

```ts
export const GameScene = defineScene('game', () => {
  // La factory s'exécute UNE fois au bootstrap — handle capturé, layout pas encore chargé
  const layout = useLayout(GameLayout, { lazy: true })

  // S'exécute à chaque activation de la scène
  onEnter(async () => await layout.load())

  // S'exécute à chaque désactivation de la scène
  onExit(async () => await layout.dispose())
})
```

**Ordre de transition** lors d'une navigation de la scène A vers la scène B :

```
onTransitionLeave({ from: A, to: B })   ← jouer l'animation de sortie
onExit()                                 ← layout.dispose() — acteurs despawnés
scene:leave
scene:enter
onEnter()                                ← layout.load() — acteurs spawnés
onTransitionEnter({ from: A, to: B })   ← jouer l'animation d'entrée
```

::: warning Utilisez toujours `lazy: true` dans les factories de scène
Sans `{ lazy: true }`, `useLayout` appelle `load()` immédiatement pendant la factory — au bootstrap, avant qu'aucune scène ne soit active. Utilisez `lazy: true` chaque fois que le layout doit se charger et se décharger avec le cycle de vie de la scène.
:::

API `LayoutHandle` :

| | |
|---|---|
| `layout.load()` | Activer — spawne tous les acteurs placés. Retourne `Promise<void>` |
| `layout.dispose()` | Désactiver — despawne tous les acteurs placés. Retourne `Promise<void>` |
| `layout.active` | `true` si le layout est chargé |
| `layout.refs` | Record typé de valeurs `PlaceHandle` |

## Exemple complet — HUD de jeu

Un acteur HUD qui met à jour le score et la santé, placé dans un layout qui persiste entre les scènes :

```ts
// src/actors/hud.ts
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'

export const HUDActor = defineActor(HUDPrefab, () => {
  const data = useComponent(HUDData)

  onUpdate(() => {
    renderHUD({ score: data.score, health: data.health })
  })

  return {
    setScore:  (n: number) => { data.score  = n },
    setHealth: (n: number) => { data.health = n },
  }
})

// src/layouts/game-layout.ts
import { HUDActor } from '../actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, { at: [0, 0] })
  return { hud }
})

// src/scenes/game-scene.ts
import { GameLayout } from '../layouts/game-layout'

export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout, { lazy: true })

  onEnter(async () => await layout.load())
  onExit(async ()  => await layout.dispose())
})

// Mettre à jour le HUD depuis un autre système — via refs.api
layout.refs.hud.api.setScore(newScore)
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
| `placeActor(def, options?)` | Placer un acteur — retourne `PlaceHandle<API>` |
| `placeGroup(options?)` | Créer une entité d'ancrage transform uniquement — retourne `PlaceHandle<void>` |
| `placePrefab(def, options?)` | Placer une entité prefab — retourne `PlaceHandle<void>` |
| `useLayout(def, options?)` | Obtenir le handle de contrôle du layout (`{ lazy }` pour différer le chargement) |
| `layout.load()` | Activer le layout (`Promise<void>`) |
| `layout.dispose()` | Désactiver le layout (`Promise<void>`) |
| `layout.active` | `true` si le layout est chargé |
| `layout.refs` | Record typé des handles placés |
| `handle.api` | API publique de l'acteur |
| `handle.moveTo([x, y])` | Repositionner l'entité |
| `handle.despawn()` | Despawner cette entité |

## Étapes suivantes

- **[Scènes](/fr/essentials/scenes)** — Comment les scènes fonctionnent avec les layouts.
- **[Acteurs](/fr/essentials/actors)** — Construire les acteurs d'UI placés dans votre layout.
- **[Prefabs](/fr/essentials/prefabs)** — Définir la disposition des composants pour vos acteurs.
