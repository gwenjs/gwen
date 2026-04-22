---
title: Scènes
description: Regroupez les systèmes et acteurs en états de jeu distincts — menus, gameplay, cinématiques — avec defineScene().
---

# Scènes

Une **scène** regroupe les systèmes et acteurs actifs pour un état de jeu. Changez de scène pour modifier ce qui s'exécute — menu pause, gameplay, cinématique.

::: info Auto-imports
Dans un projet GWEN, les composables sont disponibles sans aucune ligne `import` — le framework génère les déclarations de types globaux au moment du build. Vous écrivez `defineScene(...)`, `useSystem(...)`, `onEnter(...)` directement, sans import.
:::

## Setup vs Runtime

C'est le concept le plus important de GWEN : la factory de `defineScene` s'exécute **une seule fois au bootstrap**, avant qu'aucune scène ne soit active. Tout ce que vous écrivez directement dans le corps de la factory est la *phase de setup* — vous déclarez ce que la scène possède.

`onEnter` et `onExit` sont la *phase d'exécution* — ils s'exécutent à chaque navigation.

```ts
export const GameScene = defineScene('game', () => {

  // ── Phase de setup (une fois au bootstrap) ───────────────────────
  const player = useActor(PlayerActor)        // enregistre — ne spawne pas encore
  const move   = useSystem(MovementSystem())  // enregistre — ne s'exécute pas encore

  // ── Phase d'exécution (à chaque navigation) ──────────────────────
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))  // maintenant il spawne
  onExit(() => player.despawnAll())                      // maintenant il nettoie
})
```

Les handles capturés dans le setup (`player`, `move`) sont disponibles en closure dans les callbacks d'exécution. Ce pattern déclarer-puis-utiliser est cohérent dans les scènes, acteurs, systèmes et layouts.

## Ordre du cycle de vie

Lors d'une navigation de la scène **A** vers la scène **B**, les callbacks se déclenchent dans cet ordre :

```
A: onTransitionLeave({ from: 'A', to: 'B' })   ← jouer l'animation de sortie, attendu
A: onExit()                                      ← despawner les acteurs, disposer les layouts
   scene:leave
   scene:enter
B: onEnter(params?)                              ← spawner les acteurs, charger les layouts
B: onTransitionEnter({ from: 'A', to: 'B' })    ← jouer l'animation d'entrée, attendu
```

## Déclarer des acteurs

Utilisez `useActor(def)` dans le corps de la factory pour enregistrer un acteur et obtenir un handle de spawn :

```ts
import { PlayerActor } from './actors/player'
import { EnemyActor }  from './actors/enemy'

export const GameScene = defineScene('game', () => {
  useSystem(MovementSystem())

  const player = useActor(PlayerActor)
  const enemy  = useActor(EnemyActor)

  onEnter(() => {
    player.spawnOnce({ x: 400, y: 530 })
    enemy.spawn({ x: 100, y: 100 })
    enemy.spawn({ x: 700, y: 100 })
  })

  onExit(() => {
    player.despawnAll()
    enemy.despawnAll()
  })
})
```

Voir [Acteurs](/fr/essentials/actors) pour l'API complète de l'`ActorHandle`.

## Contrôler les systèmes à l'exécution

`useSystem()` retourne un `SystemHandle` pour mettre en pause et reprendre les systèmes pendant la scène :

```ts
export const GameScene = defineScene('game', () => {
  const player = useActor(PlayerActor)
  const combat = useSystem(CombatSystem(player))

  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())

  // Pendant une cinématique — appelé depuis un hook ou un autre système :
  // combat.pause()
  // combat.resume()
})
```

| | |
|---|---|
| `SystemHandle.pause()` | Arrêter les callbacks de frame, préserver l'état |
| `SystemHandle.resume()` | Redémarrer les callbacks |
| `SystemHandle.destroy()` | Supprimer définitivement le système |
| `SystemHandle.active` | `true` si le système est en cours d'exécution |

::: warning Pause manuelle et superpositions
Si une superposition de scène met la scène sous-jacente en pause, les systèmes sont automatiquement mis en pause par le moteur. Un système mis en pause manuellement ne sera pas réactivé automatiquement à la fermeture de la superposition — appelez `.resume()` explicitement.
:::

## Animations de transition

Utilisez `onTransitionLeave` et `onTransitionEnter` pour jouer des animations autour des changements de scène. Les deux callbacks sont attendus avant que le moteur continue.

```ts
export const GameScene = defineScene('game', () => {
  onTransitionLeave(async ({ from, to }) => {
    await fadeOut(300)   // attendu avant onExit
  })

  onTransitionEnter(async ({ from, to }) => {
    await fadeIn(300)    // attendu après onEnter
  })
})
```

## Lire les paramètres du routeur

Utilisez `useSceneRouter(router)` pour lire les paramètres passés par `nav.send()` lors de la transition :

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
- **[Layouts](/fr/essentials/layouts)** — Couches d'UI persistantes qui survivent aux transitions de scènes.
- **[Hooks](/fr/essentials/hooks)** — Réagissez aux événements du cycle de vie des scènes depuis les systèmes.
