---
title: Qu'est-ce que GWEN ?
description: GWEN est un framework de jeu web orienté TypeScript avec un cœur Rust/WASM.
---

# Qu'est-ce que GWEN ?

GWEN est un moteur de jeu web composable qui combine l'expérience développeur de TypeScript avec les performances de Rust/WebAssembly. Écrivez votre logique de jeu en TypeScript tandis que les systèmes gourmands en CPU—ECS, physique et mathématiques—s'exécutent en WebAssembly précompilé. Aucun Rust requis ; aucun compromis sur les performances.

## L'idée centrale

GWEN divise les responsabilités entre deux mondes :

**Couche Rust/WASM** — La fondation qui compte. Votre moteur ECS, simulation physique et utilitaires mathématiques s'exécutent en WebAssembly précompilé pour une vitesse maximale. Pensez-y comme le « runtime du moteur ».

**Couche TypeScript** — La couche de jeu où vous passez votre temps. Définissez des composants, écrivez des systèmes, créez des scènes et construisez du gameplay en pur TypeScript. Vous ne vous écrivez jamais ou compilez Rust.

Les deux mondes communiquent via un pont mince : votre code TypeScript appelle des fonctions WASM, WASM lit et écrit des structures de données, et les événements reviennent à TypeScript. C'est transparent, idiomatique et rapide.

## Pour qui est GWEN ?

**Les développeurs de jeux web** qui veulent des performances quasi-natives sans quitter TypeScript. GWEN se situe dans l'écart :

- **Canvas/WebGL brut ?** Trop bas niveau. Vous réécrivez la physique, les entrées, le rendu à partir de zéro.
- **Un moteur de jeu complet comme Godot ?** Trop pointilleux. Vous ne pouvez pas facilement ajouter votre propre moteur de rendu ou physique.
- **Three.js ou Babylon.js ?** Excellent pour le rendu, mais pas d'ECS, pas de physique, pas de gestion de scènes.

GWEN est la couche manquante : une fondation composable, native TypeScript pour les jeux web qui ne dicte pas comment vous rendez ou ce que vous construisez.

## Comment ça marche

Voici l'architecture en un coup d'œil :

```
┌─ Your Game Code (TypeScript) ─────────────────┐
│  systems, components, scenes, plugins         │
└─────────────────────┬─────────────────────────┘
                      │ imports @gwenjs/*
         ┌─────────────┴─────────────┐
         │  @gwenjs/core             │
         │  @gwenjs/app              │
         │  @gwenjs/physics2d        │
         │  etc.                     │
         └─────────────┬─────────────┘
                      │ WASM bindings
┌─────────────────────┴──────────────────────────┐
│  gwen_core.wasm (Rust/WASM)                   │
│  - ECS engine                                  │
│  - Linear memory (component data)              │
│  - Physics (Rapier)                            │
│  - Math primitives                             │
└────────────────────────────────────────────────┘
```

**Le code du jeu** reste en TypeScript. Vous appelez des fonctions comme `engine.update()` ou générez des entités. **Le moteur WASM** exécute les systèmes sur toutes les entités, lit leurs données de la mémoire linéaire et retourne les résultats. **Les liaisons TypeScript** vous permettent de définir des systèmes en tant que fonctions TypeScript que WASM appelle chaque frame.

## Étapes suivantes

- **[Démarrage rapide](/fr/guide/quick-start)** — Créez et exécutez votre premier projet GWEN en 5 minutes.
- **[Installation](/fr/guide/installation)** — Ajoutez GWEN à un projet existant.
- **[Structure du projet](/fr/guide/project-structure)** — Comprenez comment un projet GWEN est organisé.
- **[Plongée approfondie dans l'architecture](/fr/essentials/architecture)** — Apprenez comment l'ECS, le pont WASM et le système de plugins fonctionnent ensemble.
