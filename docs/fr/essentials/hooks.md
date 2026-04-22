---
title: Hooks
description: Communiquez entre acteurs et systèmes avec des événements typés en utilisant useHook, emit et defineHooks.
---

# Hooks

Le système de hooks de GWEN vous permet à toute partie de votre jeu d'écouter et de déclencher des événements typés — sans références directes entre acteurs, systèmes et plugins. C'est le canal de communication principal pour le code de jeu découplé.

::: info Chemins d'import
`useHook` et `emit` ne sont **pas** auto-importés. Importez-les toujours explicitement :
```ts
import { useHook, emit, defineHooks } from '@gwenjs/core'
```
`defineHooks` est auto-importé.
:::

## Écouter des événements

Utilisez `useHook(name, fn)` à l'intérieur d'une fabrique de système, acteur ou scène pour vous abonner à un événement. L'abonnement est nettoyé automatiquement quand le contexte se termine.

```ts
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(() => {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
    console.log('Score:', score)
  })
})
```

`useHook` retourne une fonction de désabonnement que vous pouvez appeler plus tôt si nécessaire :

```ts
const stop = useHook('player:died', () => { ... })
// Plus tard :
stop()
```

## Émettre des événements

Utilisez `emit(name, ...args)` pour déclencher un événement à partir de n'importe quel contexte moteur. Tous les handlers enregistrés s'exécutent de manière synchrone avant que `emit` ne retourne.

```ts
import { defineActor, useComponent } from '@gwenjs/core/actor'
import { emit } from '@gwenjs/core'
import { Health } from './components'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const health = useComponent(Health)

  return {
    takeDamage: (n: number) => {
      health.current -= n
      emit('enemy:hit', n)
      if (health.current <= 0) emit('enemy:die')
    },
  }
})
```

## Définir des hooks personnalisés

Utilisez `defineHooks()` pour déclarer des contrats typés pour vos événements de jeu. Cela vous donne l'auto-complétion TypeScript complet sur les noms d'événements et les types d'arguments dans l'ensemble du projet.

```ts
// src/hooks.ts
import { defineHooks } from '@gwenjs/core'

export const GameHooks = defineHooks({
  'enemy:die':  (): void => undefined,
  'enemy:hit':  (_damage: number): void => undefined,
  'score:add':  (_points: number): void => undefined,
  'player:die': (): void => undefined,
})
```

`defineHooks` est une fonction d'identité — son seul but est de laisser TypeScript déduire la carte d'événements. La valeur est sa signature de type.

## Augmenter GwenRuntimeHooks

Pour obtenir la sécurité complète des types sur `useHook` et `emit` dans l'ensemble du projet, augmentez `GwenRuntimeHooks` dans `@gwenjs/schema` :

```ts
// src/hooks.ts
import { defineHooks } from '@gwenjs/core'
import type { InferHooks } from '@gwenjs/core'

export const GameHooks = defineHooks({
  'enemy:die':  (): void => undefined,
  'enemy:hit':  (_damage: number): void => undefined,
  'score:add':  (_points: number): void => undefined,
})

declare module '@gwenjs/schema' {
  interface GwenRuntimeHooks extends InferHooks<typeof GameHooks> {}
}
```

Après cela, `useHook('enemy:die', () => {})` et `emit('enemy:hit', 50)` sont entièrement typés — les noms d'événements incorrects ou les types d'arguments sont détectés à la compilation.

::: warning Utilisez `@gwenjs/schema`, pas `@gwenjs/app`
L'interface à augmenter est `GwenRuntimeHooks` dans `@gwenjs/schema`. Augmenter `@gwenjs/app` n'a aucun effet.
:::

## Nettoyage automatique

Le nettoyage est automatique et dépend du contexte :

| Contexte | Quand le handler est supprimé |
|---|---|
| Dans `defineSystem` | Quand la scène se termine |
| Dans `defineActor` | Quand l'acteur est despawné |
| Dans `defineScene` | Quand la scène se termine |
| Acteur en dormance de pool | Le handler est silencieux (non supprimé) jusqu'à réactivation |
| Plugin `setup()` | Manuel — sauvegardez la fonction de désabonnement retournée et appelez-la dans `engine:stop` |

## Convention de nommage

Préfixez les noms d'événements avec un espace de noms :

```ts
'enemy:hit'       // ✅ avec espace de noms
'score:add'       // ✅ avec espace de noms
'hit'             // ❌ trop générique — peut entrer en collision
```

Les espaces de noms `engine:*`, `entity:*`, `scene:*`, `actor:*` et `plugin:*` sont réservés aux événements du framework intégré.

## Événements intégrés

| Événement | Args | Quand |
|---|---|---|
| `engine:init` | — | Une fois, après la configuration de tous les plugins |
| `engine:start` | — | Une fois, au démarrage de la boucle de frame |
| `engine:stop` | — | Une fois, à l'arrêt du moteur |
| `engine:tick` | `dt: number` | Chaque début de frame |
| `engine:afterTick` | `dt: number` | Chaque fin de frame |
| `engine:before-update` | `dt: number` | Avant la physique |
| `engine:update` | `dt: number` | Phase de mise à jour principale |
| `engine:after-update` | `dt: number` | Après la phase de mise à jour |
| `engine:render` | — | Phase de rendu |
| `entity:spawn` | `id: EntityId` | Entité créée |
| `entity:destroy` | `id: EntityId` | Entité détruite |
| `scene:enter` | `name, params?` | Scène activée |
| `scene:beforeLeave` | `name` | Avant la désactivation de la scène |
| `scene:leave` | `name` | Scène désactivée |
| `scene:transition:leave` | `{ from, to }` | Avant l'animation de sortie |
| `scene:transition:enter` | `{ from, to }` | Après l'animation d'entrée |
| `actor:enable` | `entityId` | Portée de l'acteur reprise |
| `actor:disable` | `entityId` | Portée de l'acteur mise en pause |
| `engine:error` | `EngineErrorPayload` | Erreur de frame non gérée |

## Résumé de l'API

| | |
|---|---|
| `useHook(name, fn)` | S'abonner à un événement ; retourne une fonction de désabonnement |
| `emit(name, ...args)` | Déclencher un événement de manière synchrone |
| `defineHooks(map)` | Déclarer un contrat d'événement typé |
| `InferHooks<T>` | Mapper le résultat de `defineHooks` à la forme `GwenRuntimeHooks` |

## Étapes suivantes

- **[Systèmes](/fr/essentials/systems)** — Utiliser `useHook` dans un contexte système.
- **[Acteurs](/fr/essentials/actors)** — Utiliser `useHook` et `emit` dans les acteurs.
- **[Hooks avancés](/fr/advanced/hooks)** — Approfondissement : internes des hooks, priorités, hooks asynchrones.
