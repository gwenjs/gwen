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
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Damage } from './components'

export const BulletPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { vx: 5, vy: 0 } },
  { def: Damage,   defaults: { value: 10 } },
])
```

:::tip Les noms de champs sont importants
Les surcharges de `spawn()` sont un merge **flat** appliqué à tous les composants. Si deux composants partagent le même nom de champ (ex. les deux ont `x`), une seule surcharge impacte les deux. Utilisez des noms distincts entre composants — `x`/`y` pour la position, `vx`/`vy` pour la vélocité — pour que les surcharges soient sans ambiguïté.
:::

### Générer à partir d'un prefab

Utilisez `usePrefab()` pour obtenir un handle pour générer et supprimer des entités :

```ts
import { usePrefab } from '@gwenjs/core/actor'
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { BulletPrefab } from './prefabs'

export const FireSystem = defineSystem(function FireSystem() {
  const bullet = usePrefab(BulletPrefab)

  onUpdate(() => {
    if (shouldFire) {
      // Override Position.x/y — Velocity.vx/vy gardent leurs valeurs par défaut
      const id = bullet.spawn({ x: playerX, y: playerY })
    }
  })
})
```

`usePrefab()` retourne un `PrefabHandle` avec deux méthodes :
- `spawn(overrides?)` — Créer une entité, retourne son ID en `bigint`
- `despawn(id)` — Détruire une entité par ID

```ts
// Spawn à une position précise ; vélocité et dégâts utilisent les defaults du prefab
const bulletId = bullet.spawn({ x: 100, y: 50 })

// Plus tard, supprimer la balle
bullet.despawn(bulletId)
```

### Surcharges partielles

Les surcharges sont mergées shallow dans les defaults de chaque composant. Seuls les champs passés changent, le reste garde ses valeurs déclarées :

```ts
// Position surchargée, Velocity.vx/vy et Damage.value restent aux defaults
const id = bullet.spawn({ x: 200, y: 300 })

// Override position et direction de vélocité
const id = bullet.spawn({ x: 100, y: 100, vx: -5 })

// Utiliser tous les defaults — spawn à l'origine, part vers la droite, 10 dégâts
const id = bullet.spawn()
```

## En pratique

### Prefab ennemi avec plusieurs composants

Voici un prefab réaliste pour les ennemis dans un jeu de tir :

```ts
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, Health, AI } from './components'

export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { vx: 0, vy: 0 } },
  { def: Health,   defaults: { current: 50, max: 50 } },
  { def: AI,       defaults: { state: 0 } }, // État 0 = patrouille
])
```

Dans votre système de génération :

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { usePrefab } from '@gwenjs/core/actor'
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
