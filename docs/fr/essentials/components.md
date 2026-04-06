---
title: Composants
description: Les composants sont la couche de données de l'ECS de GWEN. Apprenez à les définir et les utiliser.
---

# Composants

Dans l'ECS de GWEN, **les composants sont des données pures**. Ils contiennent des champs typés mais n'ont aucune logique ou méthode. Plusieurs composants s'attachent à la même entité pour la décrire complètement. Ce guide vous montre comment définir des composants, comprendre leur disposition en mémoire et les utiliser dans les systèmes.

## Les bases

### Définir un composant

Utilisez `defineComponent()` pour déclarer un composant avec un schéma typé :

```ts
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})

export const Velocity = defineComponent({
  name: 'Velocity',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})

export const Health = defineComponent({
  name: 'Health',
  schema: {
    current: Types.i32,
    max: Types.i32,
  },
})
```

### Composants étiquette

Un composant étiquette a un schéma vide — c'est un marqueur qu'une entité a une certaine propriété :

```ts
export const PlayerTag = defineComponent({
  name: 'PlayerTag',
  schema: {},
})

export const DeadTag = defineComponent({
  name: 'DeadTag',
  schema: {},
})
```

Les étiquettes sont utiles pour filtrer les entités dans les requêtes sans stocker de données.

### Accéder aux données des composants

Une fois qu'un composant est défini, vous accédez à ses champs en utilisant l'indexation par tableau par ID d'entité :

```ts
// À l'intérieur d'un système
const entities = useQuery([Position])

onUpdate(() => {
  for (const id of entities) {
    Position.x[id] = 100
    Position.y[id] = 200
    console.log(Position.x[id]) // 100
  }
})
```

Chaque champ (ex. : `Position.x`, `Position.y`) est un objet `TypedArray` dans la mémoire linéaire de WASM. Vous l'indexez comme un tableau normal.

## Types disponibles

GWEN supporte ces types primitifs dans les schémas de composants :

| Type | TypeScript | Plage | Cas d'usage |
|---|---|---|---|
| `Types.f32` | `number` | Flottant 32 bits | Positions, échelles, rotations |
| `Types.f64` | `number` | Flottant 64 bits | Mathématiques haute précision |
| `Types.i32` | `number` | -2³¹ à 2³¹ - 1 | Compteurs, IDs, santé |
| `Types.ui32` | `number` | 0 à 2³² - 1 | Compteurs non-signés, minuteurs |
| `Types.i16` | `number` | -32768 à 32767 | Données compressées, décalages |
| `Types.ui16` | `number` | 0 à 65535 | Données compressées, indices de texture |
| `Types.i8` | `number` | -128 à 127 | Drapeaux d'octet, petits compteurs |
| `Types.ui8` | `number` | 0 à 255 | Drapeaux d'octet, codes de caractère |

Choisissez les types avec soin : les types plus petits utilisent moins de mémoire et améliorent l'efficacité du cache.

## En pratique

### Composer plusieurs composants

Une entité gagne du comportement en combinant des composants. Voici un schéma courant :

```ts
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: { x: Types.f32, y: Types.f32 },
})

export const Health = defineComponent({
  name: 'Health',
  schema: { current: Types.i32, max: Types.i32 },
})

export const Armor = defineComponent({
  name: 'Armor',
  schema: { value: Types.f32 },
})

export const DeadTag = defineComponent({
  name: 'DeadTag',
  schema: {},
})

// Créer une entité avec plusieurs composants
const engine = useEngine()
const enemyId = engine.spawn([
  [Position, { x: 100, y: 50 }],
  [Health, { current: 50, max: 50 }],
  [Armor, { value: 2.5 }],
])
```

Maintenant les systèmes peuvent lire et écrire ces données :

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core'

export const DamageSystem = defineSystem(() => {
  const enemies = useQuery([Health, Armor], { exclude: [DeadTag] })

  onUpdate(() => {
    for (const id of enemies) {
      const armor = Armor.value[id]
      if (armor > 0) {
        Armor.value[id] *= 0.99 // L'armure se dégrade avec le temps
      }

      if (Health.current[id] <= 0) {
        // Ajouter l'étiquette morte
        addComponent(id, DeadTag)
      }
    }
  })
})
```

### Ajouter et supprimer des composants

Parfois vous devez ajouter ou supprimer un composant d'une entité vivante :

```ts
import { addComponent, removeComponent } from '@gwenjs/core'

// Ajouter un composant
addComponent(entityId, Position, { x: 10, y: 20 })

// Supprimer un composant
removeComponent(entityId, Velocity)
```

**Note :** Ajouter/supprimer des composants est relativement coûteux (réalloue les buffers), donc faites-le rarement, pas chaque frame.

## Sous le capot

### Disposition Structure-of-Arrays

GWEN stocke les composants en format **Structure-of-Arrays** (SoA) dans la mémoire WASM. C'est différent d'une approche orientée objet typique.

**Orienté objet (Inefficace) :**
```
Entity 0: { x: 10, y: 20, vx: 1, vy: 0, health: 100 }
Entity 1: { x: 30, y: 40, vx: 2, vy: 1, health: 80 }
Entity 2: { x: 50, y: 60, vx: 1, vy: 1, health: 60 }
// Mauvais : types de données mélangés ; mauvaise localité du cache
```

**Structure-of-Arrays (Efficace) :**
```
Position.x:  [10, 30, 50, ...]
Position.y:  [20, 40, 60, ...]
Velocity.x:  [1,  2,  1,  ...]
Velocity.y:  [0,  1,  1,  ...]
Health:      [100, 80, 60, ...]
// Bon : tableaux homogènes ; excellente localité du cache
```

Quand un système itère sur les entités et lit `Position.x[id]`, il accède à un tableau contigu. Le cache du CPU charge plusieurs valeurs à la fois. C'est pourquoi l'ECS est plus rapide que la POO pour la logique de jeu.

### Vues TypedArray

Les champs de composants sont des objets JavaScript `TypedArray` pointant directement sur la mémoire linéaire de WASM :

```ts
const pos = Position.x
// pos est un Float32Array supporté par SharedArrayBuffer
console.log(pos[0])     // Lire la position X de la première entité
pos[0] = 100            // Écrire directement dans la mémoire WASM (pas de surcharge)
```

Il n'y a pas de sérialisation, pas de copie, pas d'allocation. Juste un accès direct à la mémoire.

### Efficacité mémoire

Choisir les bons types économise de la mémoire et améliore les performances :

- La santé est au maximum 999 ? Utilisez `Types.i16` au lieu de `Types.i32` (moitié moins de mémoire)
- La rotation a besoin seulement de 0–360 ? Utilisez `Types.f32` au lieu de `Types.f64`
- Stocker 1000 entités avec position + santé + armure :
  - `f32 + f32 + i32 + i32 + f32` = 20 octets par entité = 20 KB au total
  - Bien mieux que les objets JavaScript !

## Résumé de l'API

| Fonction | Description |
|---|---|
| `defineComponent(options)` | Déclarer un composant avec un schéma typé |
| `Types.f32`, `Types.f64`, etc. | Descripteurs de type pour les champs de schéma |
| `Component.field[entityId]` | Lire ou écrire un champ de composant |
| `addComponent(id, Component, data)` | Ajouter un composant à une entité vivante |
| `removeComponent(id, Component)` | Supprimer un composant d'une entité |

## Prochaines étapes

- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui lisent et écrivent les données de composants.
- **[Architecture](/fr/essentials/architecture)** — Comprendre comment les composants s'intègrent dans l'ECS de GWEN.
- **[Scènes et acteurs](/fr/essentials/scenes)** — Apprendre comment créer des entités dans les scènes.
