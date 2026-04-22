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
import { defineSystem, useQuery, onUpdate } from '@gwenjs/core/system'
import { Position, Velocity } from '../components'

export const MovementSystem = defineSystem(() => {
  const query = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const id of query) {
      Position.x[id] += Velocity.x[id] * dt
      Position.y[id] += Velocity.y[id] * dt
    }
  })
})
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
import { defineActor, definePrefab, onStart, onDestroy, useEntityId } from '@gwenjs/core/actor'
import { useDynamicBody, useBoxCollider } from '@gwenjs/physics2d'
import { Position, Health } from '../components'

const PlayerPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health,   defaults: { hp: 100 } },
])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const entityId = useEntityId()
  useDynamicBody({ gravityScale: 1 })
  useBoxCollider({ width: 1, height: 2 })

  onStart(() => {
    Position.x[entityId] = 100
    Position.y[entityId] = 100
  })
})
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
`src/plugins/audio.ts` ✅ — `src/plugins/audio/index.ts` ❌. Les sous-répertoires ne sont pas scannés. Les plugins sont conçus pour être dans un seul fichier — si un plugin devient trop volumineux, encapsulez-le dans un module local (`src/modules/`).
:::

### `src/modules/` — Modules locaux

Les fichiers de ce répertoire sont **auto-découverts et chargés avant** `config.plugins`. Ils fonctionnent exactement comme les modules npm déclarés dans `gwen.config.ts`, mais vivent dans votre projet — pas de package à publier, pas d'entrée de config requise.

Chaque fichier doit exporter une définition `defineGwenModule` comme **export par défaut** :

**src/modules/score.ts**
```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

const ScorePlugin = definePlugin<{ maxScore?: number }>((opts = {}) => ({
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
    gwen.addPlugin(ScorePlugin(options))
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

declare module '@gwenjs/app' {
  interface GwenModuleOptions {
    score?: ScoreOptions
  }
}

export default defineGwenModule<ScoreOptions>({
  meta: { configKey: 'score' },
  defaults: { maxScore: 999 },
  setup(options, gwen) {
    gwen.addPlugin(ScorePlugin(options))
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

Les plugins et modules sont appliqués dans cet ordre à chaque démarrage du moteur :

1. Plugins framework intégrés (viewports, screen)
2. `config.plugins` — inclut les plugins contribués par les modules npm au moment de la compilation
3. `src/modules/` — modules locaux (ordre alphabétique par nom de module)
4. `src/plugins/` — plugins locaux (ordre alphabétique par nom de fichier)

Les modules npm déclarés dans `gwen.config.ts → modules` s'exécutent au **moment de la compilation** et enregistrent leurs plugins via `gwen.addPlugin()`. Ces plugins atterrissent dans `config.plugins` et s'exécutent avant tout module ou plugin local.

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
