---
title: Composants
description: Les composants sont la couche de données de l'ECS de GWEN. Apprenez à les définir et à les utiliser.
---

# Composants

Dans l'ECS de GWEN, **les composants sont des données pures**. Ils contiennent des champs typés mais aucune logique ni méthode. Plusieurs composants s'attachent à la même entité pour la décrire complètement.

::: info Import explicite requis
`defineComponent` et `Types` ne sont pas auto-importés — ils servent à définir vos fichiers de composants, en dehors de tout contexte moteur. Importez-les toujours explicitement :
```ts
import { defineComponent, Types } from '@gwenjs/core'
```
:::

## Les bases

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

export const Health = defineComponent({
  name: 'Health',
  schema: {
    current: Types.i32,
    max: Types.i32,
  },
})
```

Chaque champ est stocké sous forme de tableau typé contigu en mémoire WASM. Les entités servent d'index :

`defineComponent` lève `GwenError` avec le code `CORE:COMPONENT_TYPE_LIMIT_REACHED` au 129e type de composant. La limite est 128. La vérification a lieu à la définition et n'appelle pas WASM.

```ts
// Dans un système — entity.id est un bigint
Position.x[entity.id] = 100
Position.y[entity.id] = 200
```

## Types disponibles

| Type | TypeScript | Description |
|---|---|---|
| `Types.f32` | `number` | Flottant 32 bits — positions, rotations, échelles |
| `Types.f64` | `number` | Flottant 64 bits — calculs haute précision |
| `Types.i32` | `number` | Entier signé 32 bits — santé, compteurs, IDs |
| `Types.i64` | `bigint` | Entier signé 64 bits — grands compteurs |
| `Types.u32` | `number` | Entier non signé 32 bits — timers, indices |
| `Types.u64` | `bigint` | Entier non signé 64 bits — grandes valeurs non signées |
| `Types.bool` | `boolean` | Indicateur booléen |
| `Types.string` | `string` | Chaîne internée — à utiliser avec parcimonie, pas pour les chemins critiques |

Choisissez les types avec soin : les types plus petits utilisent moins de mémoire et améliorent l'efficacité du cache.

## Composants marqueurs

Un composant marqueur a un schéma vide — il marque une entité sans stocker de données :

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

Les marqueurs sont utiles pour filtrer les entités dans les requêtes sans stocker de données.

## Valeurs par défaut

Utilisez `defaults` pour déclarer des valeurs initiales pour chaque champ. Elles sont appliquées quand un prefab crée une entité sans override explicite :

```ts
export const Health = defineComponent({
  name: 'Health',
  schema: {
    current: Types.i32,
    max: Types.i32,
  },
  defaults: {
    current: 100,
    max: 100,
  },
})
```

::: tip Les overrides de prefab ont la priorité
Quand un prefab déclare ses propres `defaults`, ils remplacent les `defaults` du composant. Les deux sont remplacés par les valeurs passées à `spawn()`.
:::

## Lire les données dans un système

Les systèmes itèrent sur un `LiveQuery<EntityAccessor>`. Chaque entité a un `.id` (bigint) pour l'accès direct aux tableaux SoA :

```ts
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const entity of entities) {
      Position.x[entity.id] += Velocity.x[entity.id] * dt
      Position.y[entity.id] += Velocity.y[entity.id] * dt
    }
  })
})
```

Vous pouvez également lire un composant comme un objet simple avec `entity.get(def)` :

```ts
onUpdate(() => {
  for (const entity of entities) {
    const pos = entity.get(Position) // { x: number, y: number } | undefined
  }
})
```

## Lire les données dans un acteur

Dans une factory `defineActor`, utilisez `useComponent()` pour obtenir un proxy réactif en direct :

```ts
import { Health } from './components'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)

  onUpdate(() => {
    if (health.current <= 0) {
      // gérer la mort
    }
  })
})
```

::: warning Contexte acteur uniquement
`useComponent()` ne fonctionne que dans `defineActor`. Dans les systèmes, utilisez `entity.get(def)` ou l'accès direct aux tableaux SoA (`Component.field[entity.id]`) à la place.
:::

Voir [Acteurs](/fr/essentials/actors) pour la documentation complète de `useComponent`.

## Re-exporter les composants

Utilisez un fichier barrel pour garder des imports propres dans tout votre projet :

```ts
// src/components/index.ts
export * from './Position'
export * from './Velocity'
export * from './Health'
```

## Disposition Structure-of-Arrays

GWEN stocke les composants au format **Structure-of-Arrays** (SoA) en mémoire WASM :

```
Position.x:  [10, 30, 50, ...]    ← Float32Array contigu
Position.y:  [20, 40, 60, ...]
Velocity.x:  [1,  2,  1,  ...]
Health.current: [100, 80, 60, ...]
```

Quand un système itère et lit `Position.x[entity.id]`, le CPU charge plusieurs valeurs à la fois depuis un tableau contigu. C'est pourquoi l'ECS est plus rapide que le stockage d'objets par entité.

## Résumé de l'API

| | |
|---|---|
| `defineComponent({ name, schema, defaults? })` | Déclare un type de composant |
| `Types.f32 / f64 / i32 / i64 / u32 / u64 / bool / string` | Descripteurs de type de champ |
| `Component.field[entity.id]` | Lire ou écrire un champ de composant (dans un système) |
| `useComponent(def)` | Proxy réactif de composant dans `defineActor` |

## Étapes suivantes

- **[Systèmes](/fr/essentials/systems)** — Écrivez des systèmes qui lisent et écrivent les données des composants.
- **[Acteurs](/fr/essentials/actors)** — Utilisez `useComponent()` pour un accès réactif aux composants dans les acteurs.
- **[Prefabs](/fr/essentials/prefabs)** — Regroupez des composants dans des modèles de spawn réutilisables.
