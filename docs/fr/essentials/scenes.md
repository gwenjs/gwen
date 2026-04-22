---
title: Scènes
description: Regroupez les systèmes et acteurs en états de jeu distincts — menus, gameplay, cinématiques — avec defineScene().
---

# Scènes

Une **scène** regroupe les systèmes et acteurs actifs pour un état de jeu. Changez de scène pour modifier ce qui s'exécute — menu pause, gameplay, cinématique.

::: info Auto-imports
Dans un projet GWEN, les composables sont disponibles sans aucune ligne `import` — le framework génère les déclarations de types globaux au moment du build. Vous écrivez `defineScene(...)`, `useSystem(...)`, `onEnter(...)` directement, sans import.
:::

## Les bases

Utilisez `defineScene()` pour déclarer une scène. Le corps de la factory est un contexte d'initialisation — déclarez les systèmes et acteurs via des composables.

```ts
import { MovementSystem, RenderSystem } from './systems'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())
  useSystem(RenderSystem())
})
```

## Cycle de vie d'une scène

Utilisez `onEnter` et `onExit` pour exécuter du code quand la scène s'active ou se désactive :

```ts
export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())

  onEnter(() => {
    console.log('scène activée')
  })

  onExit(() => {
    console.log('scène désactivée')
  })
})
```

`onEnter` reçoit des paramètres optionnels passés par le routeur :

```ts
onEnter((params) => {
  const level = params?.level ?? 1
  console.log('Démarrage du niveau', level)
})
```

::: tip onEnter et onExit asynchrones
Les callbacks asynchrones fonctionnent parfaitement quand `@gwenjs/vite` est configuré. Le plugin Vite propage le contexte du moteur à travers les `await`. Voir [Contexte Async](/fr/advanced/async-context) pour les détails.
:::

## Déclarer des acteurs

Utilisez `useActor(def)` dans une scène pour enregistrer un acteur et obtenir un handle de spawn :

```ts
import { PlayerActor } from './actors/player'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())

  const player = useActor(PlayerActor)

  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

`useActor()` retourne un `ActorHandle`. Voir [Acteurs](/fr/essentials/actors) pour l'API complète du handle.

## Déclarer des prefabs

Utilisez `usePrefab(def)` pour enregistrer un type de prefab pour cette scène :

```ts
const bullet = usePrefab(BulletPrefab)

onEnter(() => {
  bullet.spawn({ x: 100, y: 200 })
})
```

## Contrôler les systèmes à l'exécution

`useSystem()` retourne un `SystemHandle` que vous pouvez utiliser pour mettre en pause et reprendre les systèmes pendant la scène :

```ts
const combat = useSystem(CombatSystem(player))

// Pendant une cinématique :
combat.pause()

// Après la cinématique :
combat.resume()
```

| | |
|---|---|
| `SystemHandle.pause()` | Arrêter les callbacks de frame, préserver l'état |
| `SystemHandle.resume()` | Redémarrer les callbacks |
| `SystemHandle.destroy()` | Supprimer définitivement le système |
| `SystemHandle.active` | `true` si le système est en cours d'exécution |

::: warning Pause manuelle et superpositions
Si une superposition de scène met la scène sous-jacente en pause, les systèmes sont automatiquement mis en pause par le moteur. Un système mis en pause manuellement ne sera pas réactivé automatiquement à la fermeture de la superposition. Appelez `.resume()` explicitement.
:::

## Animations de transition

Utilisez `onTransitionLeave` et `onTransitionEnter` pour exécuter de la logique d'animation autour des changements de scène :

```ts
export const GameScene = defineScene('game', () => {
  onTransitionLeave(async ({ from, to }) => {
    // attendu avant onExit — jouez l'animation de sortie ici
    await fadeOut()
  })

  onTransitionEnter(async ({ from, to }) => {
    // attendu après onEnter — jouez l'animation d'entrée ici
    await fadeIn()
  })
})
```

- `onTransitionLeave` — appelé avant `onExit`, reçoit les noms d'état `{ from, to }`
- `onTransitionEnter` — appelé après `onEnter`, reçoit les noms d'état `{ from, to }`

## Lire les paramètres du routeur dans une scène

Utilisez `useSceneRouter(router)` dans `onEnter` pour lire les paramètres passés lors de la transition :

```ts
import { AppRouter } from '../router'

export const GameScene = defineScene('game', () => {
  const nav = useSceneRouter(AppRouter)

  onEnter(() => {
    const { level } = nav.params
    console.log('Démarrage du niveau', level)
  })
})
```

## Résumé de l'API

| | |
|---|---|
| `defineScene(name, factory)` | Déclare une scène |
| `useSystem(plugin)` | Enregistre un système → `SystemHandle` |
| `useActor(def)` | Enregistre un acteur pour cette scène → `ActorHandle` |
| `usePrefab(def)` | Enregistre un prefab pour cette scène → `PrefabHandle` |
| `onEnter(cb)` | S'exécute à l'activation de la scène ; reçoit des paramètres optionnels |
| `onExit(cb)` | S'exécute à la désactivation de la scène |
| `onTransitionLeave(cb)` | Avant l'animation de sortie ; reçoit `{ from, to }` |
| `onTransitionEnter(cb)` | Après l'animation d'entrée ; reçoit `{ from, to }` |
| `useSceneRouter(router)` | Accéder au routeur de scènes (ex : lire `nav.params`) |
| `SystemHandle.pause()` | Mettre en pause les callbacks de frame du système |
| `SystemHandle.resume()` | Reprendre les callbacks de frame du système |
| `SystemHandle.destroy()` | Supprimer définitivement le système |
| `SystemHandle.active` | `true` si le système est en cours d'exécution |

## Étapes suivantes

- **[Routeur de scènes](/fr/essentials/scene-router)** — Naviguez entre les scènes avec un automate fini.
- **[Acteurs](/fr/essentials/actors)** — Créez des entités nommées et basées sur des instances dans les scènes.
- **[Hooks](/fr/essentials/hooks)** — Réagissez aux événements du cycle de vie des scènes depuis les systèmes.
