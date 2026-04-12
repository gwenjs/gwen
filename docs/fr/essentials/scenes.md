---
title: Scènes
description: Regroupez les systèmes en états de jeu discrets — menus, gameplay, cinématiques — avec defineScene().
---

# Scènes

Une **scène** regroupe les systèmes actifs pour un état de jeu. Changez de scène pour modifier les systèmes en cours d'exécution — menu de pause, gameplay, cinématique.

## Définir une scène

Utilisez `defineScene()` pour créer une scène. La factory est un contexte de setup : déclarez les systèmes et les hooks de cycle de vie via des composables.

```typescript
import { defineScene, useSystem, onEnter, onExit } from '@gwenjs/core/scene'
import { useActor } from '@gwenjs/core/actor'
import { MovementSystem, RenderSystem } from './systems'
import { PlayerActor } from './actors/player'

export const GameScene = defineScene('game', () => {
    useSystem(MovementSystem())
    useSystem(RenderSystem())

  const player = useActor(PlayerActor)
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

## Composables de scène

| Composable | Utilisation |
|---|---|
| `useSystem([...])` | Déclare les systèmes actifs pendant cette scène |
| `onEnter(cb)` | Spawne des acteurs, charge des ressources, lance la musique à l'activation |
| `onExit(cb)` | Despawne les acteurs, libère les ressources à la sortie |

La factory s'exécute dans un contexte engine actif : `useEngine()`, `useActor()`, `usePrefab()` et `useSceneRouter()` sont tous disponibles.

## Scène minimale

Une scène sans acteurs ni hooks de cycle de vie :

```typescript
import { defineScene, useSystem } from '@gwenjs/core/scene'
import { MovementSystem, RenderSystem } from './systems'

export const GameScene = defineScene('game', () => {
  useSystem([MovementSystem, RenderSystem])
})
```

Pour naviguer entre scènes, voir [Scene Router](/fr/essentials/scene-router).

## Prochaines étapes

- **[Scene Router](/fr/essentials/scene-router)** — Naviguer entre scènes avec un automate fini.
- **[Acteurs](/fr/essentials/actors)** — Créer des entités nommées basées sur des instances au sein des scènes.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui s'exécutent dans les scènes.
