---
title: Patterns de performance
description: Boucles de chunks pour le travail en masse, fonctions partagées, et l'optimiseur que le framework installe.
---

# Patterns de performance

Utilisez un acteur pour un objet nommé. Utilisez une boucle de chunks dans un système quand la même logique s'applique à beaucoup d'entités. Le framework possède la config Vite et installe l'optimiseur.

## 1. Architecture hybride acteur / système

### Le piège

Un `onUpdate` d'acteur s'exécute une fois par instance. Beaucoup d'acteurs, cela fait beaucoup de callbacks.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab, onUpdate, useTransform } from "@gwenjs/core/actor";

const Marker = defineComponent({
  name: "EnemyMarker",
  schema: { speed: Types.f32 },
  defaults: { speed: 1 },
});

const EnemyPrefab = definePrefab([{ def: Marker, defaults: { speed: 1 } }]);

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const transform = useTransform();
  const speed = 1;

  onUpdate((dt) => {
    transform.translate(speed * dt, 0);
  });
});
```

### Le pattern

L'acteur possède l'entité et l'API publique. `useComponent(def)` prend la définition du composant et s'appelle dans la factory de l'acteur. Le système parcourt les chunks.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab, useComponent } from "@gwenjs/core/actor";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "Position",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const Enemy = defineComponent({
  name: "Enemy",
  schema: { speed: Types.f32 },
  defaults: { speed: 0 },
});

const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0 } },
  { def: Enemy, defaults: { speed: 0 } },
]);

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const enemy = useComponent(Enemy);

  return {
    setSpeed(v: number) {
      enemy.speed = v;
    },
  };
});

export const EnemyMovementSystem = defineSystem(() => {
  const query = useQuery([Position, Enemy]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      const enemy = chunk.get(Enemy);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (enemy.speed[row] ?? 0) * dt;
      }
    }
  });
});
```

| Utilisez un acteur quand | Utilisez un système quand |
|---|---|
| Un objet unique (joueur, caméra, HUD) | Beaucoup d'objets identiques (ennemis, balles, particules) |
| Vous avez besoin d'une API publique nommée | Vous avez besoin d'un seul passage sur les entités |
| L'état est propre à l'instance | La logique est la même pour chaque entité |

### Câblage dans une scène

```ts
export const GameScene = defineScene('game', () => {
  useSystem(EnemyMovementSystem())

  const enemies = useActor(EnemyActor)
  onEnter(() => {
    enemies.spawn()
  })
  ...
})
```

Le système parcourt les entités. L'acteur les fait apparaître.

## 2. Code partagé entre un système et un acteur

### Pattern A — fonctions pures

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Stats = defineComponent({
  name: "Stats",
  schema: { attack: Types.f32, armor: Types.f32, hp: Types.f32 },
  defaults: { attack: 0, armor: 0, hp: 0 },
});

export function computeDamage(base: number, multiplier: number, armor: number): number {
  return Math.max(0, base * multiplier - armor);
}

export const DamageSystem = defineSystem(() => {
  const query = useQuery([Stats]);

  onUpdate(() => {
    for (const chunk of query) {
      const stats = chunk.get(Stats);
      for (let row = 0; row < chunk.count; row += 1) {
        const next = computeDamage(stats.attack[row] ?? 0, 1.2, stats.armor[row] ?? 0);
        stats.hp[row] = (stats.hp[row] ?? 0) - next;
      }
    }
  });
});

const myStats = { attack: 10 };
const comboMultiplier = 1.2;
const targetArmor = 3;
const damage = computeDamage(myStats.attack, comboMultiplier, targetArmor);
```

### Pattern B — `useService`

Appelez `useService` dans la factory. Il renvoie la valeur enregistrée avec `engine.provide`.

```ts check
import type { GwenEngineBase } from "@gwenjs/schema";
import { definePlugin } from "@gwenjs/kit/plugin";
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { defineSystem, onUpdate, useService } from "@gwenjs/core/system";

declare module "@gwenjs/core" {
  interface GwenProvides {
    scoreBoard: { total: number };
  }
}

function createScoreBoard(): { total: number } {
  return { total: 0 };
}

function renderScore(total: number): string {
  return String(total);
}

const HUD = defineComponent({
  name: "HudMarker",
  schema: { shown: Types.f32 },
  defaults: { shown: 0 },
});

const HUDPrefab = definePrefab([{ def: HUD, defaults: { shown: 1 } }]);

definePlugin(() => ({
  name: "score-board",
  setup(engine: GwenEngineBase) {
    engine.provide("scoreBoard", createScoreBoard());
  },
}));

export const ScoreSystem = defineSystem(() => {
  const board = useService("scoreBoard");
  onUpdate(() => {
    board.total += 0;
  });
});

export const HUDActor = defineActor(HUDPrefab, () => {
  const board = useService("scoreBoard");
  onUpdate(() => {
    renderScore(board.total);
  });
});
```

## 3. La boucle de chunks

`useQuery` renvoie une `Query`. `for (const chunk of query)` produit un archétype à la fois. `chunk.get(Def)` renvoie les colonnes vivantes de ce chunk. L'index est la ligne, pas l'id d'entité. `Types.string`, `Types.i64` et `Types.u64` sont absents de ces colonnes.

Ajouter un composant qui n'est pas déjà sur l'entité écrit les valeurs par défaut, puis les clés que vous passez. L'ajouter de nouveau ne met à jour que ces clés. Le retirer supprime la ligne de ce composant. Dans une boucle de chunks ouverte, l'ajout, le retrait et la destruction attendent la fermeture de la boucle.

`query.each()` est le chemin par entité. Pendant une phase d'update, il journalise `CORE:QUERY_PER_ENTITY_PATH`.

Une écriture dans la boucle de chunks d'un système est visible pour un système plus tard dans la même frame :

```ts run
import assert from "node:assert/strict";
import { defineComponent, Types } from "@gwenjs/core";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

const Position = defineComponent({
  name: "DocsPerfChunkPos",
  schema: { x: Types.f32 },
  defaults: { x: 0 },
});

const id = engine.createEntity();
engine.addComponent(id, Position, { x: 1 });

await engine.use(
  defineSystem("docs-perf-writer", () => {
    const query = useQuery([Position]);
    onUpdate(() => {
      for (const chunk of query) {
        const pos = chunk.get(Position);
        for (let row = 0; row < chunk.count; row += 1) pos.x[row] = 11;
      }
    });
  })(),
);

let readBack = 0;
await engine.use(
  defineSystem("docs-perf-reader", () => {
    const query = useQuery([Position]);
    onUpdate(() => {
      for (const chunk of query) {
        const pos = chunk.get(Position);
        readBack = pos.x[0] ?? 0;
      }
    });
  })(),
);

await engine.startExternal();
await engine.advance(0.016);
assert.equal(readBack, 11);
```

## 4. L'optimiseur que le framework installe

Un jeu ne livre pas de fichier de config `vite` et n'appelle pas lui-même le plugin d'optimiseur. `gwenVitePlugin` l'installe toujours. L'option `optimizer` correspond à `mode` :

| `optimizer` | Résultat |
|---|---|
| omis ou `false` | `{ mode: "detect" }` |
| `true` | `{ mode: "transform" }` |
| un objet d'options | `{ mode: "transform" }`, plus `componentsDir`, `tier` et `debug` quand ils sont définis |

Deprecated: `useComponentFor` est l'appel que l'optimiseur reconnaît. Écrivez la boucle de chunks de la section 3. Réécrire cette boucle est un changement à part.

## Chemin chaud

Dans `onUpdate` :

- Lisez et écrivez les colonnes dans la boucle de chunks.
- Pas de `await`. Le callback est synchrone.
- L'ajout, le retrait et la destruction structurels dans une boucle de chunks ouverte attendent la fermeture de la boucle.
- Ne construisez pas un objet à chaque ligne.

## Résumé

| Pattern | Règle |
|---|---|
| Beaucoup d'entités | Une boucle de chunks dans un système |
| Logique pure partagée | Une fonction simple |
| État runtime partagé | `engine.provide` et `useService` dans la factory |
| Itération en masse | `for (const chunk of query)` et `chunk.get(Def)` |
| Dans `onUpdate` | Pas de `await`. Les changements structurels dans une boucle de chunks ouverte attendent sa fermeture. |
