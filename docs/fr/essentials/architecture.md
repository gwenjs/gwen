---
title: Architecture
description: Comment GWEN répartit les responsabilités entre Rust/WASM et TypeScript, et comment le modèle ECS relie les deux.
---

# Architecture

L'architecture de GWEN repose sur une séparation fondamentale : **TypeScript pour la logique de jeu, Rust/WASM pour la performance**. Ce guide vous présente les deux couches, leur mode de communication et la façon dont le modèle Entité-Composant-Système (ECS) relie le tout.

## Les deux couches

### Noyau Rust/WASM

Le cœur de GWEN est un module WebAssembly précompilé (`gwen_core.wasm`) écrit en Rust. Cette couche gère tout ce qui doit être rapide :

- **Moteur ECS** — Stocke les entités, les composants et gère efficacement les requêtes
- **Tableaux de composants** — Les données de composants résident dans la mémoire linéaire WASM en Structure-of-Arrays (SoA) pour l'efficacité du cache
- **Physique** — La simulation physique (via Rapier) s'exécute en WASM
- **Primitives mathématiques** — Vecteurs, matrices et quaternions pour le chemin critique

Vous n'écrivez jamais de Rust. Le module WASM est livré précompilé dans les paquets npm (`@gwenjs/core`, `@gwenjs/physics2d`, etc.).

### Couche TypeScript

Toute la logique de jeu que vous écrivez vit en TypeScript. Cela inclut :

- **Systèmes** — Fonctions qui lisent et écrivent les données des composants à chaque frame
- **Graphe de scène** — Acteurs, prefabs et gestion des scènes
- **Cycle de vie des plugins** — Initialisation, hooks de frame, démontage
- **Outils Vite** — Serveur de développement, HMR, bundling

La couche TypeScript appelle WASM pour interroger les entités, lire les données des composants et appliquer les mises à jour physiques.

## Le pont WASM

La communication entre TypeScript et WASM s'effectue via **la mémoire partagée et des appels de fonctions**. Il n'y a pas de sérialisation ; la mémoire linéaire WASM est exposée à TypeScript via `SharedArrayBuffer` et des vues `TypedArray`.

```
┌──────────────────────────────────────┐
│ Code TypeScript                      │
│ - defineSystem()                     │
│ - useQuery()                         │
│ - Position.x[entityId] = 10          │
└──────────────┬───────────────────────┘
               │ Accès direct à la mémoire (sans copie)
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

Quand vous écrivez `Position.x[entityId] = 10` dans un système, vous écrivez directement dans la mémoire WASM sans aucun surcoût. Pas de marshaling, pas d'allocation, pas de garbage collection.

## Aperçu de l'ECS

GWEN utilise le pattern **Entité-Composant-Système** (ECS) pour organiser les données et la logique de jeu :

### Entités

Une **entité** est un identifiant `bigint` qui regroupe des composants associés. Il n'y a pas de hiérarchie de classes — une entité est juste un nombre.

### Composants

Un **composant** est une structure de données typée contenant uniquement des données — pas de logique, pas de méthodes.

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

Plusieurs composants s'attachent à la même entité pour la décrire complètement. Un joueur pourrait avoir `Position`, `Health`, `Velocity` et `PlayerTag`.

### Systèmes

Un **système** est une fonction qui s'exécute à chaque frame sur toutes les entités correspondant à une requête. Les systèmes lisent et écrivent les données des composants.

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

`useQuery` retourne une collection live de valeurs `EntityAccessor`. Chaque élément a un `.id` (bigint) pour l'accès direct aux tableaux SoA, et une méthode `.get(def)` pour lire un composant comme un objet simple.

### Pourquoi l'ECS ?

Pas d'héritage, pas de problèmes de polymorphisme. Juste des données et de la logique. Cela rend GWEN :

- **Rapide** — Disposition mémoire efficace pour le cache (SoA) et exécution parallèle des données
- **Flexible** — Composez n'importe quelle combinaison de composants ; ajoutez de nouveaux systèmes à tout moment
- **Testable** — Les systèmes ne dépendent pas d'une hiérarchie de classes ; ce sont juste des fonctions

## Boucle de jeu

À chaque frame, GWEN exécute les callbacks dans cet ordre :

```
engine:before-update  →  onBeforeUpdate(dt)   — lecture des entrées, pré-simulation
engine:update         →  onUpdate(dt)          — logique principale, IA, mouvement
engine:after-update   →  onAfterUpdate(dt)     — synchronisation d'état, score
engine:render         →  onRender()            — appels de rendu
```

Les systèmes et acteurs enregistrent des callbacks dans la phase appropriée via des composables (`onUpdate`, `onRender`, etc.).

## Étapes suivantes

- **[Le moteur](/fr/essentials/engine)** — Configurez votre jeu avec `gwen.config.ts`.
- **[Composants](/fr/essentials/components)** — Définissez les structures de données de votre jeu.
- **[Systèmes](/fr/essentials/systems)** — Écrivez des systèmes qui donnent vie aux composants.
- **[Structure du projet](/fr/guide/project-structure)** — Voyez comment un vrai projet GWEN organise ses systèmes et composants.
