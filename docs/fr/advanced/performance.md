---
title: Patterns de performance
description: Boucles de chunks pour le travail en masse, fonctions partagées, et l'option optimizer qui remonte les lectures de colonnes.
---

# Patterns de performance

Utilisez un acteur pour un objet nommé. Utilisez une boucle de chunks dans un système quand la même logique s'applique à beaucoup d'entités. Avec `optimizer: true`, le build lit pour vous les colonnes d'une boucle de lignes de chunk une seule fois, pour les boucles qui remplissent ses préconditions.

## 1. Architecture hybride acteur / système

### Le piège

Un `onUpdate` d'acteur s'exécute une fois par instance. Beaucoup d'acteurs, cela fait beaucoup de callbacks.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab, useTransform } from "@gwenjs/core/actor";
import { onUpdate } from "@gwenjs/core/system";

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
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { useComponent } from "@gwenjs/core/system";
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

declare module "@gwenjs/schema" {
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

definePlugin({ provides: ["scoreBoard"] }, () => ({
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

`chunk.get(Def)` coûte une recherche à chaque appel. Appelez-le une fois par chunk, avant la boucle de lignes, et indexez les colonnes renvoyées dans la boucle. Une boucle qui l'appelle à chaque ligne paie cette recherche à chaque ligne. La section suivante décrit l'étape de build qui le fait pour vous.

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

## 4. L'option optimizer

Avec `optimizer: true`, `gwen:hoist-chunk-columns` sort de la boucle chaque `chunk.get(Def)` d'une boucle de lignes de chunk. Il le lit une fois, dans un `const` placé avant la boucle de lignes, et la boucle utilise ce local. La réécriture garde les résultats de la boucle. Elle ne s'applique qu'aux boucles qui passent ses préconditions. Une boucle qui en manque une reste telle que vous l'avez écrite, et le build n'avertit pas. Voir [Remonter les lectures de colonnes](/fr/advanced/build-pipeline#hoisting-column-lookups) pour les préconditions et les noms générés, et [`gwenVitePlugin`](/fr/api/vite) pour l'option.

Deux outils vous laissent le contrôle :

- `// @gwen-no-optimize` avant une boucle, ou avant une instruction qui l'entoure, garde cette boucle telle qu'écrite. Voir [Désactiver une optimisation](/fr/advanced/build-pipeline#opting-out).
- `optimizer: { debug: true }` journalise une ligne pour chaque boucle de lignes de chunk qu'elle inspecte et laisse intacte, avec la première précondition manquée. Voir [Boucles ignorées](/fr/advanced/build-pipeline#skipped-loops) pour les boucles qui ne journalisent rien. Un avertissement de build voisin, [`VITE:HOT_PATH_LOOKUP`](/fr/api/errors#vite-hot-path-lookup), signale un appel à `useQuery`, `useService` ou `useWasmModule` dans un callback de frame.

### Ce qui est mesuré

Les durées dépendent de la machine : cette page n'en cite aucune. Trois fichiers portent la preuve. Vous pouvez exécuter les deux premiers, et `pnpm test:alloc` lit le troisième :

- `packages/core/bench/system-iteration.bench.ts` exécute une boucle de chunks deux fois sur un vrai moteur : telle qu'écrite, et telle que la transformation l'écrit. Chaque ligne mesure un appel à `advance`, pour deux nombres d'entités. Une boucle qui lit déjà ses colonnes une seule fois n'a rien à changer pour l'unité.
- `packages/core/tests/integration-wasm/p69-hot-path-parity.test.ts` exécute les deux versions sur un vrai moteur et compare chaque valeur de `Position` et de `Velocity`. Les valeurs sont égales bit à bit.
- La ligne `update.system.optimized` de `packages/core/bench/alloc-thresholds.json` enregistre la barrière d'allocation de la boucle réécrite. La barrière échoue quand les octets par entité et par frame dépassent la valeur enregistrée de plus de sa marge.

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

## Capacité d'instances Node

Avec le gestionnaire de traps de V8, chaque instance WASM réserve environ 10 GiB d'espace d'adressage virtuel. Les mesures Linux arm64 (Node v22.23.3) donnent un `vm_per_inst_gib` de 10. Cette exécution échoue à l'instance 24147 après en avoir tenu 24146.

Sous `ulimit -v` de L GiB, la création d'une instance échoue à l'instance `floor((L - base_vm_gib) / 10) + 1` ± 1. `base_vm_gib` est la mémoire virtuelle du processus en GiB avant la première instance. L'erreur est `RangeError: WebAssembly.Instance(): Out of memory: Cannot allocate Wasm memory for new instance`.

`--disable-wasm-trap-handler` combiné à cette limite interrompt le processus. Le code de sortie enregistré sur Linux arm64 est 134 (tas V8 fatal à court de mémoire). Cette combinaison n'est pas prise en charge.
