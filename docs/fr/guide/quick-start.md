---
title: Démarrage rapide
description: Obtenez un projet GWEN exécuté en moins de cinq minutes.
---

# Démarrage rapide

Le moyen le plus rapide de démarrer un projet GWEN est d'utiliser le scaffold. En quelques secondes, vous aurez un modèle de jeu fonctionnel avec tous les outils configurés.

## Prérequis

- **Node.js 18+** et **pnpm 8+**
- Aucun Rust requis—WASM est livré précompilé dans les packages npm

::: tip
Si vous n'avez pas pnpm, installez-le globalement : `npm install -g pnpm`
:::

## Créer un projet

```sh
pnpm create @gwenjs/create my-game
cd my-game
pnpm install:all
pnpm dev
```

Votre navigateur devrait s'ouvrir sur `http://localhost:5173` avec votre premier jeu en cours d'exécution.

## Disposition du projet

Le scaffold crée un projet de jeu structuré :

```
my-game/
├── gwen.config.ts           # Config de compilation (modules, options moteur)
└── src/
    ├── components/          # Définitions defineComponent()
    │   └── Position.ts
    ├── systems/             # Implémentations defineSystem()
    │   └── Movement.ts
    ├── scenes/              # Définitions defineScene()
    │   └── GameScene.ts
    ├── actors/              # defineActor() — entités basées sur les instances
    │   └── Player.ts
    ├── prefabs/             # definePrefab() — modèles réutilisables
    │   └── Bullet.ts
    └── router.ts            # defineSceneRouter() — FSM de navigation des scènes
```

## Configuration de compilation — `gwen.config.ts`

Définissez les options du moteur à la compilation :

<<< @/../examples/hello-light/gwen.config.ts{ts}

## Votre premier composant

Un composant est une donnée. Définissons un composant `Position` :

**src/components/Position.ts**

<<< @/../examples/hello-light/src/components/Position.ts{ts}

## Votre premier système

Les systèmes itèrent sur les entités et les mettent à jour à chaque frame.

**src/systems/Movement.ts**

<<< @/../examples/hello-light/src/systems/Movement.ts{ts}

## Votre première scène

**src/scenes/GameScene.ts**

<<< @/../examples/hello-light/src/scenes/GameScene.ts{ts}

## Routeur de scènes

Définissez la navigation entre les scènes :

**src/router.ts**

<<< @/../examples/hello-light/src/router.ts{ts}

## Exécutez-le

```sh
pnpm dev
```

Ouvrez votre navigateur. Vous devriez voir votre jeu s'exécuter—le système de mouvement met à jour les positions à chaque frame, et vous voyez le résultat rendu.

## Étapes suivantes

- **[Installation](/fr/guide/installation)** — Ajoutez GWEN à un projet existant.
- **[Structure du projet](/fr/guide/project-structure)** — Comprendre l'anatomie d'un projet GWEN.
- **[Le moteur](/fr/essentials/engine)** — Apprenez la configuration et le démarrage du moteur.
- **[Composants](/fr/essentials/components)** — Concevez des schémas de composants.
- **[Systèmes](/fr/essentials/systems)** — Maîtrisez les requêtes et crochets de cycle de vie des systèmes.
