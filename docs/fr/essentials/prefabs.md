---
title: Prefabs
description: Les prefabs sont des modèles d'entités réutilisables qui vous permettent de générer plusieurs entités avec les mêmes composants et valeurs initiales.
---

# Prefabs

Un **prefab** est un modèle réutilisable pour générer des entités. Au lieu de générer manuellement la même combinaison de composants et de valeurs par défaut encore et encore, définissez un prefab une seule fois et générez-le plusieurs fois. Les prefabs sont essentiels pour générer des balles, des ennemis, des objets collectibles et d'autres éléments répétés dans votre jeu.

## Les bases

### Définir un prefab

Utilisez `definePrefab()` pour déclarer un modèle d'entité réutilisable :

```ts
import { definePrefab } from '@gwenjs/core'
import { Position, Velocity, Damage } from './components'

export const BulletPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { x: 5, y: 0 } },
  { def: Damage, defaults: { value: 10 } },
])
```

### Générer à partir d'un prefab

Utilisez `usePrefab()` pour obtenir un handle pour générer et supprimer des entités :

```ts
import { usePrefab, defineSystem, onUpdate } from '@gwenjs/core'
import { BulletPrefab } from './prefabs'

export const FireSystem = defineSystem(() => {
  const bullet = usePrefab(BulletPrefab)

  onUpdate(() => {
    if (shouldFire) {
      // Générer une balle à la position du joueur
      const id = bullet.spawn({
        x: playerX,
        y: playerY,
      })
    }
  })
})
```

`usePrefab()` retourne un `PrefabHandle` avec deux méthodes :
- `spawn(overrides?)` — Créer une entité, retourne son ID
- `despawn(id)` — Détruire une entité par ID

L'ID d'entité retourné est un `bigint` que vous pouvez utiliser pour suivre et supprimer les entités plus tard :

```ts
const bulletId = bullet.spawn({
  x: 100,
  y: 50,
})

// Plus tard, supprimer la balle
bullet.despawn(bulletId)
```

### Surcharges partielles

Lors de la génération, vous n'avez besoin de surcharger que les champs qui vous intéressent. Les valeurs par défaut complètent le reste :

```ts
// Utilise les dommages par défaut (10), position et vélocité personnalisées
const id = bullet.spawn({
  x: 200,
  y: 300,
})

// Utilise toutes les valeurs par défaut sauf la position
const id = bullet.spawn({
  x: 100,
  y: 100,
})
```

## En pratique

### Prefab ennemi avec plusieurs composants

Voici un prefab réaliste pour les ennemis dans un jeu de tir :

```ts
import { definePrefab } from '@gwenjs/core'
import { Position, Velocity, Health, AI } from './components'

export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { current: 50, max: 50 } },
  { def: AI, defaults: { state: 0 } }, // État 0 = patrouille
])
```

Dans votre système de génération :

```ts
import { defineSystem, onUpdate, usePrefab } from '@gwenjs/core'
import { EnemyPrefab } from './prefabs'

export const EnemySpawnerSystem = defineSystem(() => {
  const enemy = usePrefab(EnemyPrefab)

  onUpdate(() => {
    // Générer les ennemis aux emplacements aléatoires
    for (let i = 0; i < enemiesToSpawn; i++) {
      enemy.spawn({
        x: Math.random() * 800,
        y: Math.random() * 600,
      })
    }
  })
})
```

### Prefabs vs Acteurs

**Les prefabs** sont pour générer beaucoup d'entités similaires (balles, ennemis, pièces). **Les acteurs** sont pour les entités uniques et nommées (le joueur, un boss, un panneau d'interface utilisateur).

- **Utilisez un prefab** si : Vous générez 0 à plusieurs de ces entités pendant le jeu
- **Utilisez un acteur** si : Exactement une instance existe, ou elle a une gestion du cycle de vie spéciale (comme le joueur ou le menu principal)

Voir [Scènes et acteurs](/fr/essentials/scenes) pour en savoir plus sur les acteurs.

## Résumé de l'API

| Fonction | Description |
|---|---|
| `definePrefab(components)` | Déclarer un modèle d'entité réutilisable avec la syntaxe de tableau |
| `usePrefab(PrefabDef)` | Obtenir un handle pour une instance de prefab |
| `handle.spawn(overrides?)` | Créer une entité à partir du prefab, retourne l'ID d'entité |
| `handle.despawn(id)` | Supprimer une entité générée à partir du prefab |

## Prochaines étapes

- **[Scènes et acteurs](/fr/essentials/scenes)** — Découvrez comment les acteurs complètent les prefabs pour les entités uniques.
- **[Layouts](/fr/essentials/layouts)** — Persister l'interface utilisateur dans plusieurs scènes à l'aide de layouts.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui interagissent avec les entités générées.
