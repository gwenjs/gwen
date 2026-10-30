---
title: Structure du projet
description: Vue d'ensemble d'une disposition typique de projet GWEN.
---

# Structure du projet

Comprendre comment un projet GWEN est organisé vous aide à écrire du code qui se met à l'échelle et reste maintenable. Voici une structure typique et ce que chaque répertoire fait.

## Disposition typique

```
my-game/
├── gwen.config.ts           # Configuration du framework et du moteur
└── src/
    ├── components/          # defineComponent() — définitions de données ECS
    │   └── Position.ts
    ├── systems/             # defineSystem() — logique de jeu
    │   └── Movement.ts
    ├── scenes/              # defineScene() — définitions de scènes
    │   └── GameScene.ts
    ├── actors/              # defineActor() — objets de jeu basés sur les instances
    │   └── Player.ts
    ├── prefabs/             # definePrefab() — modèles d'entités
    │   └── Bullet.ts
    ├── router.ts            # defineSceneRouter() — FSM de navigation des scènes
    ├── plugins/             # definePlugin() — plugins locaux
    ├── modules/             # defineGwenModule() — modules locaux
    ├── assets/              # images, audio, polices...
    └── utils/               # utilitaires partagés
```

::: info Fichiers auto-générés
`index.html` et `main.ts` sont générés automatiquement par le framework GWEN. Vous n'avez jamais besoin de les créer ou de les modifier.
:::

## Objectifs des répertoires

### `gwen.config.ts` — Configuration

Déclare les modules et les options du moteur à la compilation :

```typescript
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
  },
})
```

### `src/components/` — Définitions de composants

Chaque fichier définit un ou plusieurs schémas de composants. Les composants sont des conteneurs de données attachés aux entités.

**src/components/Position.ts**
```typescript
import { defineComponent, Types } from '@gwenjs/core'

export const Position = defineComponent({
  name: 'Position',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})
```

**src/components/Velocity.ts**
```typescript
import { defineComponent, Types } from '@gwenjs/core'

export const Velocity = defineComponent({
  name: 'Velocity',
  schema: {
    x: Types.f32,
    y: Types.f32,
  },
})
```

**src/components/Health.ts**
```typescript
import { defineComponent, Types } from '@gwenjs/core'

export const Health = defineComponent({
  name: 'Health',
  schema: {
    hp: Types.f32,
  },
})
```

Utilisez `src/components/index.ts` pour réexporter tout :

```typescript
export * from './Position'
export * from './Velocity'
export * from './Health'
```

### `src/systems/` — Implémentations de systèmes

Les systèmes sont la couche logique. Ils interrogent les entités et modifient leurs composants à chaque frame.

**src/systems/Movement.ts**
```typescript
import { Position, Velocity } from "../components";
import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity]);

  onUpdate((dt) => {
    for (const chunk of query) {
      const pos = chunk.get(Position);
      const vel = chunk.get(Velocity);
      for (let row = 0; row < chunk.count; row += 1) {
        pos.x[row] = (pos.x[row] ?? 0) + (vel.x[row] ?? 0) * dt;
        pos.y[row] = (pos.y[row] ?? 0) + (vel.y[row] ?? 0) * dt;
      }
    }
  });
});
```

### `src/scenes/` — Définitions de scènes

Les scènes sont des fonctions qui configurent le gameplay et enregistrent les systèmes :

**src/scenes/GameScene.ts**
```typescript
import { defineScene, useSystem } from '@gwenjs/core/scene'
import { MovementSystem, CollisionSystem, RenderSystem } from '../systems'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())
  useSystem(CollisionSystem())
  useSystem(RenderSystem())
})
```

### `src/actors/` — Entités nommées

Les acteurs sont des entités nommées, de type singleton, définies avec `defineActor()`. Utilisez-les pour les éléments qui existent une seule fois par scène — le joueur, un boss, une caméra. Chaque acteur a son propre cycle de vie (`onStart`, `onDestroy`) et peut utiliser des composables physiques.

**src/actors/Player.ts**
```typescript
import { defineActor, definePrefab, onStart, useComponent } from "@gwenjs/core/actor";
import { useBoxCollider, useDynamicBody } from "@gwenjs/physics2d";
import { Position, Health } from "../components";

const PlayerPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health, defaults: { hp: 100 } },
]);

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const pos = useComponent(Position);
  useDynamicBody({ gravityScale: 1 });
  useBoxCollider({ w: 1, h: 2 });

  onStart(() => {
    pos.x = 100;
    pos.y = 100;
  });
});
```

### `src/prefabs/` — Modèles d'entités réutilisables

Les préfabriqués sont définis avec `definePrefab()` pour les entités que vous générez en masse — balles, pièces, ennemis. Ils déclarent quels composants chaque instance obtient et leurs valeurs par défaut.

**src/prefabs/Bullet.ts**
```typescript
import { definePrefab } from '@gwenjs/core/actor'
import { Position, Velocity, DamageTag } from '../components'

export const BulletPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { x: 0, y: 10 } },
  { def: DamageTag, defaults: {} },
])
```

### `src/plugins/` — Plugins locaux

Les fichiers de ce répertoire sont **auto-découverts et enregistrés automatiquement** — aucune entrée dans `gwen.config.ts` n'est nécessaire.

Chaque fichier doit exporter une factory `definePlugin` comme **export par défaut** :

**src/plugins/audio.ts**
```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export default definePlugin(() => ({
  name: 'audio',
  setup(engine) {
    const manager = createAudioManager() // votre propre implémentation
    engine.provide('audio', manager)
    engine.hooks.hook('engine:stop', () => manager.dispose())
  },
}))
```

::: info Export par défaut, pas nommé
Le framework appelle la factory sans arguments au moment de l'enregistrement. Si votre plugin a besoin d'options de `gwen.config.ts`, utilisez un module local à la place (voir `src/modules/` ci-dessous).
:::

::: tip Fichiers plats uniquement
`src/plugins/audio.ts` ✅ — `src/plugins/audio/index.ts` ❌. Les sous-répertoires ne sont pas scannés. Les plugins sont conçus pour tenir dans un seul fichier — si un plugin devient trop volumineux, encapsulez-le dans un module local (`src/modules/`).
:::

### `src/modules/` — Modules locaux

Les fichiers de ce répertoire sont **auto-découverts**. Ils s'exécutent au **moment de la compilation**, et les plugins qu'ils déclarent s'installent après `config.plugins` et avant `src/plugins/`. Ils fonctionnent exactement comme les modules npm déclarés dans `gwen.config.ts`, mais vivent dans votre projet — pas de package à publier, pas d'entrée de config requise.

Chaque fichier doit exporter une définition `defineGwenModule` comme **export par défaut** :

**src/modules/score.ts**
```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

export const ScorePlugin = definePlugin<{ maxScore?: number }>((opts = {}) => ({
  name: 'score',
  setup(engine) {
    let score = 0
    engine.provide('score', {
      get: () => score,
      add: (n: number) => { score = Math.min(score + n, opts.maxScore ?? 999) },
      reset: () => { score = 0 },
    })
  },
}))

export default defineGwenModule({
  meta: { configKey: 'score' }, // nom inféré → 'local:score'
  defaults: { maxScore: 999 },
  setup(options, gwen) {
    gwen.addPlugin({ src: "./src/modules/score", export: "ScorePlugin", options })
  },
})
```

**Inférence du nom** — `meta.name` est optionnel pour les modules locaux :

| Fichier | Nom inféré |
|---|---|
| `src/modules/score.ts` | `local:score` |
| `src/modules/score/index.ts` | `local:score` |
| `meta: { name: 'my-score' }` explicite | `my-score` |

**Recevoir des options de `gwen.config.ts`** — quand `meta.configKey` est défini, utilisez l'augmentation `GwenModuleOptions` dans le même fichier pour l'auto-complétion TypeScript :

```ts
// src/modules/score.ts
interface ScoreOptions {
  maxScore?: number
}

declare module '@gwenjs/schema' {
  interface GwenModuleOptions {
    score?: ScoreOptions
  }
}

export default defineGwenModule<ScoreOptions>({
  meta: { configKey: 'score' },
  defaults: { maxScore: 999 },
  setup(options, gwen) {
    gwen.addPlugin({ src: "./src/modules/score", export: "ScorePlugin", options })
  },
})
```

Les modules locaux sont auto-découverts — aucune entrée `modules:` n'est nécessaire. Seule la clé d'options apparaît dans `gwen.config.ts` :

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  score: { maxScore: 9999 },
})
```

::: tip Support des sous-répertoires
`src/modules/score/index.ts` est supporté et inféré comme `local:score`. Utilisez-le pour diviser un module complexe en plusieurs fichiers.
:::

### `src/assets/` — Fichiers statiques

Gardez les sprites, sons, données de niveau et autres ressources organisés ici. Vite s'occupera du bundling et de l'optimisation.

```
assets/
├── sprites/
│   ├── player.png
│   ├── enemies/
│   └── ui/
├── sounds/
│   ├── jump.wav
│   └── music/
└── levels/
    ├── level1.json
    └── level2.json
```

### `src/utils/` — Utilitaires partagés

Utilitaires communs sans catégorie propre : fonctions mathématiques, aides d'entrée, gestionnaires d'état, etc.

**src/utils/math.ts**
```typescript
export function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function distance(x1: number, y1: number, x2: number, y2: number) {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}
```

## Ordre de chargement

Les plugins et modules sont appliqués dans cet ordre :

1. Plugins framework intégrés (viewports, screen)
2. `gwenConfig.plugins`
3. Plugins déclarés par les modules au moment de la compilation (modules npm, puis `src/modules/`)
4. `src/plugins/`
5. Systèmes de scène

Les modules npm déclarés dans `gwen.config.ts → modules` et les modules locaux dans `src/modules/` s'exécutent au **moment de la compilation** dans `setupModules` (les modules locaux après les modules npm, chargés par `jiti` ; un dossier personnalisé vient de `localModulesDir`, `false` les désactive) et enregistrent leurs plugins via `gwen.addPlugin()`. Le bundle navigateur n'exécute aucun `setup` de module ; il installe la liste de plugins résolue (plugins de la config, puis les plugins déclarés par les modules, puis les plugins locaux, puis les systèmes de scène) un par un et, si une installation échoue, arrête le moteur avant d'afficher l'erreur.

## Modèles de mise à l'échelle

À mesure que votre jeu grandit, considérez ces modèles organisationnels :

**Par fonctionnalité** — Groupez les composants, systèmes et scènes connexes ensemble :

```
src/
├── features/
│   ├── player/
│   │   ├── components/
│   │   ├── systems/
│   │   └── prefabs/
│   ├── enemies/
│   │   ├── components/
│   │   ├── systems/
│   │   └── prefabs/
│   └── ui/
│       ├── systems/
│       └── scenes/
```

**Par responsabilité** — Gardez les systèmes, composants et préfabriqués dans leurs propres répertoires de haut niveau (illustrés ci-dessus). Cela fonctionne bien pour les petits jeux.

**Par domaine** — Séparez le gameplay, les graphiques, la physique, l'audio et la mise en réseau dans leurs propres domaines avec des plugins.

## Bonnes pratiques

1. **Utilisez les fichiers d'index** — Réexportez depuis `components/index.ts`, `systems/index.ts`, etc., pour des imports propres.
2. **Un composant par fichier** — Plus facile à trouver et à refactoriser.
3. **Nommez les systèmes d'après ce qu'ils font** — `MovementSystem`, `CollisionSystem`, pas `UpdateLogic`.
4. **Préfabriqués pour les entités complexes** — Si une entité utilise 3+ composants, créez un préfabriqué pour cela.
5. **Plugins pour les fonctionnalités réutilisables** — Gestion des entrées, UI, animations—emballez dans des plugins pour que d'autres projets puissent les réutiliser.

## Prochaines étapes

- **[Composants](/fr/essentials/components)** — Apprenez à concevoir des schémas de composants.
- **[Systèmes](/fr/essentials/systems)** — Maîtrisez les requêtes et crochets de système.
- **[Scènes](/fr/essentials/scenes)** — Composez et gérez les scènes.
- **[Préfabriqués](/fr/essentials/prefabs)** — Créez des modèles d'entités réutilisables.
