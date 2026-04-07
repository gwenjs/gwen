---
title: Layouts
description: Les layouts sont des couches d'interface utilisateur persistantes qui survivent aux transitions de scènes, parfaits pour les HUD, les menus et les éléments d'interface utilisateur persistants.
---

# Layouts

Un **layout** est une couche d'interface utilisateur persistante qui existe au-dessus de toutes les scènes. Contrairement aux scènes (qui se chargent et se déchargent), un layout persiste lors des transitions de scènes. Utilisez les layouts pour les HUD, les barres de menu, les boîtes de dialogue de pause et toute interface utilisateur qui devrait survivre lorsque vous changez de scènes.

## Les bases

### Définir un layout

Utilisez `defineLayout()` pour créer une couche d'interface utilisateur persistante :

```ts
import { defineLayout, placeActor } from '@gwenjs/core/actor'
import { HUDActor } from './actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor)
  return { hud }
})
```

### Charger un layout

Les layouts sont généralement chargés au démarrage ou lors de l'entrée du gameplay :

```ts
import { defineSystem } from '@gwenjs/core'
import { useLayout } from '@gwenjs/core/actor'
import { GameLayout } from './layouts'

export const LayoutInitSystem = defineSystem(() => {
  const level = useLayout(GameLayout)

  onUpdate(() => {
    if (!level.active && shouldLoadLayout) {
      level.load() // Persister ce HUD dans toutes les scènes
    }
  })
})
```

Ou à partir d'une initialisation du routeur de scènes :

```ts
import { defineSceneRouter } from '@gwenjs/core/scene'
import { GameLayout } from './layouts'

export const router = defineSceneRouter({
  scenes: { menu: MenuScene, game: GameScene },
  initial: 'menu',
  onRouterInit: async (router) => {
    // Charger le layout au démarrage du jeu
    const level = useLayout(GameLayout)
    await level.load()
  },
})
```

## En pratique

### HUD avec santé et score

Un exemple de HUD réaliste :

```ts
// components/hud.ts
import { defineComponent, Types } from '@gwenjs/core'

export const HUDData = defineComponent({
  name: 'HUDData',
  schema: {
    score: Types.i32,
    health: Types.i32,
  },
})
```

```ts
// actors/hud.ts
import { defineActor, onStart, onUpdate } from '@gwenjs/core/actor'
import { useQuery, useEngine } from '@gwenjs/core'
import { HUDData } from '../components/hud'
import { Health, Position } from '../components'

export const HUDActor = defineActor({
  name: 'HUD',
  setup() {
    let hudEntity: bigint

    onStart(() => {
      const engine = useEngine()
      // Générer l'entité HUD
      hudEntity = engine.spawn([
        [HUDData, { score: 0, health: 100 }],
      ])
    })

    onUpdate(() => {
      // Mettre à jour le HUD à partir de l'état du jeu
      const players = useQuery([Health, Position])

      for (const playerId of players) {
        HUDData.score[hudEntity] += 10
        HUDData.health[hudEntity] = Health.current[playerId]
      }

      // Afficher le HUD (canvas, DOM, etc.)
      renderHUD({
        score: HUDData.score[hudEntity],
        health: HUDData.health[hudEntity],
      })
    })
  },
})
```

### Le layout persiste lors des changements de scènes

Voici l'avantage clé : le layout reste actif lorsque vous changez de scènes :

```ts
// Commencer dans MenuScene (pas de HUD)
router.push('menu')

// Passer à GameScene (HUD apparaît)
router.push('game') // GameLayout est toujours actif, HUD est rendu

// Passer à PauseScene (HUD reste)
router.push('pause') // Même HUD, mêmes données

// Retour à GameScene (HUD continue)
router.pop() // Le HUD est toujours là avec les mêmes valeurs
```

### Mise à jour des données du layout à partir des systèmes

Les layouts fournissent une couche de données partagées que tout système de scène peut lire et écrire :

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'
import { useLayout } from '@gwenjs/core/actor'
import { GameLayout } from './layouts'
import { Health } from './components'
import { HUDData } from './components/hud'

export const HealthSyncSystem = defineSystem(() => {
  const players = useQuery([Health])
  const level = useLayout(GameLayout)

  onUpdate(() => {
    for (const playerId of players) {
      // Mettre à jour le HUD directement à partir du système de n'importe quelle scène
      if (level.active && level.refs.hud) {
        const hudEntity = level.refs.hud // Référence à l'entité HUD générée
        HUDData.health[hudEntity] = Health.current[playerId]
      }
    }
  })
})
```

## Layout vs Scène

- **Les scènes** se chargent/déchargent en tant qu'unité. Une nouvelle scène signifie de nouveaux systèmes, de nouveaux acteurs, de nouvelles données.
- **Les layouts** persistent dans toutes les scènes. Un layout, un ensemble d'acteurs d'interface utilisateur, données partagées.

Utilisez **les layouts** pour :
- HUD de santé/score/chrono
- Barres de menu ou navigation en haut
- Boîtes de dialogue persistantes ou notifications
- Gestionnaires audio ou d'entrée globaux

Utilisez **les scènes** pour :
- États du jeu (menu, gameplay, fin de partie)
- Logique et entités spécifiques au niveau
- Nettoyage et gestion de la mémoire entre les états

## Résumé de l'API

| Fonction | Description |
|---|---|
| `defineLayout(factory)` | Déclarer une couche d'interface utilisateur persistante |
| `useLayout(LayoutDef, opts?)` | Obtenir le contrôle du layout à partir d'un système ou d'un acteur |
| `layout.load()` | Charger/activer le layout |
| `layout.dispose()` | Décharger/désactiver le layout |
| `layout.active` | Booléen indiquant si le layout est chargé |
| `layout.refs` | Objet contenant des références aux acteurs placés |

## Prochaines étapes

- **[Scènes](/fr/essentials/scenes)** — Découvrez comment les scènes fonctionnent avec les layouts.
- **[Prefabs](/fr/essentials/prefabs)** — Générer les éléments de l'interface utilisateur à l'aide de prefabs.
- **[Acteurs](/essentials/actors)** — Créer des acteurs d'interface utilisateur personnalisés pour votre layout.
