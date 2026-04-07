---
title: Scènes
description: Regroupez les systèmes en états de jeu discrets — menus, gameplay, cinématiques — avec defineScene().
---

# Scènes

Une **scène** regroupe les systèmes actifs pour un état de jeu. Changez de scène pour modifier les systèmes en cours d'exécution — menu de pause, gameplay, cinématique.

## Définir une scène

Utilisez `defineScene()` pour créer une scène. Deux formes sont disponibles :

**Forme options :**

```typescript
import { defineScene } from '@gwenjs/core/scene'
import { MovementSystem, RenderSystem } from './systems'

export const GameScene = defineScene({
  name: 'game',
  systems: [MovementSystem, RenderSystem],
})
```

**Forme factory** — pour les requêtes inline, les hooks de cycle de vie et la configuration réactive :

```typescript
// imports omitted for brevity
export const GameScene = defineScene('game', () => {
  const entities = useQuery({ with: [Position, Velocity] })

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
    }
  })
})
```

Pour naviguer entre scènes, voir [Scene Router](/fr/essentials/scene-router).

## Prochaines étapes

- **[Scene Router](/fr/essentials/scene-router)** — Naviguer entre scènes avec un automate fini.
- **[Acteurs](/fr/essentials/actors)** — Créer des entités nommées basées sur des instances au sein des scènes.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui s'exécutent dans les scènes.
