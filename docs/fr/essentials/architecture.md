---
title: Architecture
description: Comment GWEN répartit les responsabilités entre Rust/WASM et TypeScript, et comment la couche ECS les rassemble.
---

# Architecture

L'architecture de GWEN repose sur une division fondamentale : **TypeScript pour la logique de jeu, Rust/WASM pour la performance**. Ce guide vous explique les deux couches, comment elles communiquent, et comment le modèle Entity-Component-System (ECS) rassemble tout.

## Les deux couches

### Cœur Rust/WASM

Le cœur de GWEN est un module WebAssembly pré-compilé (`gwen_core.wasm`) écrit en Rust. Cette couche gère tout ce qui doit être rapide :

- **Moteur ECS** — Stocke les entités, les composants et gère les requêtes efficacement
- **Tableaux de composants** — Les données des composants vivent dans la mémoire linéaire de WASM en disposition Structure-of-Arrays (SoA) pour l'efficacité du cache
- **Physique** — La simulation physique (via Rapier) s'exécute dans WASM
- **Primitives mathématiques** — Les mathématiques vectorielles, matricielles et les quaternions pour le chemin critique

Vous n'écrivez jamais de Rust. Le module WASM arrive pré-compilé dans les paquets npm (`@gwenjs/core`, `@gwenjs/physics2d`, etc.).

### Couche TypeScript

Toute la logique de jeu que vous écrivez vit en TypeScript. Cela inclut :

- **Systèmes** — Fonctions qui lisent et écrivent les données de composants chaque frame
- **Graphe de scène** — Acteurs, préfabriqués et gestion de scène
- **Cycle de vie du plugin** — `mount()`, `onStart()`, `onUpdate()`, `onDestroy()`, `unmount()`
- **Outils Vite** — Serveur de développement, HMR, bundling

La couche TypeScript appelle WASM pour interroger les entités, lire les données de composants et appliquer les mises à jour physiques.

## Le pont WASM

La communication entre TypeScript et WASM se fait via **la mémoire partagée et les appels de fonctions**. Il n'y a pas de sérialisation ; au lieu de cela, la mémoire linéaire de WASM est exposée à TypeScript via `SharedArrayBuffer` et les vues `TypedArray`.

```
┌──────────────────────────────────────┐
│ TypeScript Code                      │
│ - defineSystem()                     │
│ - useQuery()                         │
│ - Position.x[entityId] = 10          │
└──────────────┬───────────────────────┘
               │ Accès direct à la mémoire (pas de copie)
┌──────────────┴───────────────────────┐
│ SharedArrayBuffer                    │
│ ┌────────────────────────────────┐   │
│ │ Mémoire linéaire WASM          │   │
│ │ ┌──────────────────────────┐   │   │
│ │ │ Position.x: [1, 2, 3]    │   │   │
│ │ │ Position.y: [4, 5, 6]    │   │   │
│ │ └──────────────────────────┘   │   │
│ └────────────────────────────────┘   │
└──────────────────────────────────────┘
```

Quand vous écrivez `Position.x[entityId] = 10` dans un système, vous écrivez directement dans la mémoire de WASM sans surcharge. Pas de marshaling, pas d'allocations, pas de garbage collection.

## Aperçu de l'ECS

GWEN utilise le modèle **Entity-Component-System** (ECS) pour organiser les données et la logique du jeu :

### Entités

Une **entité** est un ID entier qui regroupe les composants associés.

```ts
// En interne, une entité est juste un nombre
const playerId = 42
```

Il n'y a pas de hiérarchie d'héritage, pas de hiérarchie de classes. Une entité est juste un conteneur.

### Composants

Un **composant** est une structure de données typée contenant des données pures — aucune logique, aucune méthode.

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
```

Plusieurs composants s'attachent à la même entité pour la décrire. Un joueur peut avoir `Position`, `Health`, `Velocity`, et `PlayerTag`.

### Systèmes

Un **système** est une fonction qui s'exécute chaque frame sur toutes les entités correspondant à une requête. Les systèmes lisent et écrivent les données de composants.

```ts
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of entities) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
```

La requête `[Position, Velocity]` retourne tous les ID d'entités qui ont les deux composants. Le système met à jour leurs positions en fonction de la vélocité.

### Pourquoi l'ECS ?

Pas d'héritage, pas de maux de tête du polymorphisme. Juste des données + logique. Les systèmes sont des fonctions pures qui lisent et écrivent les données. Cela rend GWEN :

- **Rapide** — Disposition de la mémoire efficace pour le cache (SoA) et exécution data-parallel
- **Flexible** — Composez n'importe quelle combinaison de composants ; ajoutez de nouveaux systèmes à tout moment
- **Testable** — Les systèmes ne dépendent pas d'une hiérarchie de classes ; ce sont juste des fonctions

## Cycle de vie du plugin

Les moteurs GWEN chargent des plugins, qui se montent et se démontent pendant le cycle de vie du jeu :

```
Boot
  ↓
engine.start()
  ↓
mount() sur chaque plugin
  ↓
Charger la scène initiale
  ↓
onStart() sur chaque acteur → onStart() sur chaque système
  ↓
Boucle de jeu :
  - onUpdate(dt) sur chaque système
  - Rendu (via votre renderer)
  ↓
onDestroy() sur chaque acteur → onDestroy() sur chaque système
  ↓
Décharger la scène
  ↓
unmount() sur chaque plugin
  ↓
Arrêt
```

Les systèmes enregistrent les callbacks pendant leur phase de configuration (`defineSystem(() => { ... })`). Ces callbacks se déclenchent pendant les étapes de cycle de vie appropriées.

## Flux de données : De TypeScript à WASM et retour

Voici comment un frame typique s'exécute :

```
1. Le code TypeScript crée une nouvelle entité
   → Appel de la fonction WASM : spawn(components...)
   → WASM alloue l'ID de l'entité, initialise les données de composant

2. Le frame commence
   → TypeScript appelle useQuery([Position, Velocity])
   → La requête retourne un tableau d'ID d'entités correspondantes
   → Le code TypeScript itère et lit/écrit les données de composant
   → Les données vivent dans la mémoire de WASM ; TypeScript y accède via la vue TypedArray

3. Tick physique
   → Le moteur physique WASM (Rapier) s'exécute
   → Met à jour les composants Rigidbody et Transform

4. Rendu
   → TypeScript lit Position, Rotation, etc.
   → Passe au renderer (Babylon.js, Three.js, Canvas 2D, etc.)

5. Fin du frame
   → Synchronisation de l'état physique et graphique
   → Le frame suivant commence
```

L'idée clé : **pas de copie de données**. TypeScript accède directement à la mémoire de WASM. Votre boucle de jeu est efficace en mémoire.

## Prochaines étapes

- **[Le moteur](/fr/essentials/engine)** — Créer et configurer votre premier moteur GWEN.
- **[Composants](/fr/essentials/components)** — Définir les structures de données que votre jeu utilisera.
- **[Systèmes](/fr/essentials/systems)** — Écrire les systèmes qui donnent vie aux composants.
- **[Structure du projet](/fr/guide/project-structure)** — Voir comment un vrai projet GWEN organise les systèmes et les composants.
