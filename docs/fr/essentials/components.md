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

`defineComponent` lève `GwenError` avec le code `CORE:INVALID_COMPONENT_SCHEMA` quand un champ n'est pas un `SchemaType`. Il ne lève rien pour un second layout d'un nom connu, ni pour le 129e nom. Chaque moteur attribue l'id et vérifie le budget de 128 noms la première fois qu'il utilise un nom. Le 129e nom lève `GwenError` avec le code `CORE:COMPONENT_TYPE_LIMIT_REACHED`. Un usage ultérieur avec d'autres octets de lanes lève `GwenError` avec le code `CORE:COMPONENT_LAYOUT_INVALID`. Définir à nouveau le même nom avec les mêmes lanes garde l'id de type dans ce moteur. Les ids de type sont propres à chaque moteur : chaque moteur en attribue un la première fois qu'il voit un nom, donc deux moteurs peuvent donner des ids différents au même composant. Deux moteurs peuvent utiliser un même nom avec des lanes différentes. Les octets de lanes sont les lanes scalaires dans l'ordre des champs : `vec2` / `vec3` / `vec4` / `quat` / `color` comptent pour 2 / 3 / 4 / 4 / 4 lanes f32. Un champ renommé, un réordonnancement de champs aux mêmes lanes, `vec2` à la place de deux `f32`, ou `Types.string` à la place de `Types.persistentString`, garde les mêmes lanes : le moteur l'accepte et réutilise l'id. Les mêmes lanes réutilisent cet id et gardent les octets du premier usage : un champ réordonné n'échange pas les valeurs stockées, et `Types.persistentString` après `Types.string` écrit encore l'id de chaîne dans le pool de scène.

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
`useComponent()` ne fonctionne que dans `defineActor`.
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

## Résumé de l'API

| | |
|---|---|
| `defineComponent({ name, schema, defaults? })` | Déclare un type de composant |
| `Types.f32 / f64 / i32 / i64 / u32 / u64 / bool / string` | Descripteurs de type de champ |
| `useComponent(def)` | Proxy réactif de composant dans `defineActor` |

## Étapes suivantes

- **[Systèmes](/fr/essentials/systems)** — Écrivez des systèmes qui lisent et écrivent les données des composants.
- **[Acteurs](/fr/essentials/actors)** — Utilisez `useComponent()` pour un accès réactif aux composants dans les acteurs.
- **[Prefabs](/fr/essentials/prefabs)** — Regroupez des composants dans des modèles de spawn réutilisables.
