---
title: Routeur de scènes
description: Navigation entre scènes basée sur un automate fini avec des transitions typées.
---

# Routeur de scènes

Le **routeur de scènes** orchestre les transitions entre scènes à l'aide d'un automate fini. Définissez des états et des transitions une fois ; naviguez par programmation depuis les systèmes ou les scènes.

> Les scènes sont définies séparément avec `defineScene()`. Voir [Scènes](/fr/essentials/scenes).

::: info Auto-imports
Dans un projet GWEN, `defineSceneRouter` et `useSceneRouter` sont auto-importés — pas besoin de ligne `import` pour les composables eux-mêmes. Créez votre objet routeur dans `src/router.ts` et importez **cet objet** là où vous appelez `useSceneRouter` :
```ts
import { AppRouter } from './router'  // importer l'objet routeur, pas le composable
```
:::

## Les bases

`defineSceneRouter()` déclare les états et les transitions. Toutes les cibles d'état sont validées au moment de la définition — les erreurs sont levées immédiatement, pas au runtime.

```ts
import { MenuScene, GameScene, GameOverScene } from './scenes'

export const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: {
      scene: MenuScene,
      on: { START: 'game' },
    },
    game: {
      scene: GameScene,
      on: { PAUSE: 'pause', GAME_OVER: 'gameOver' },
    },
    gameOver: {
      scene: GameOverScene,
      on: { RESTART: 'game', MENU: 'menu' },
    },
  },
})
```

::: tip Aucune inscription nécessaire
`defineSceneRouter` est autonome. Créez-le simplement dans `src/router.ts` et importez-le là où vous avez besoin de `useSceneRouter`. Aucune entrée dans `gwen.config.ts` n'est requise.
:::

## Naviguer

Appelez `useSceneRouter(router)` à l'intérieur d'un système ou d'un plugin pour obtenir le handle, puis utilisez `nav.send()` pour déclencher les transitions.

**Depuis un système (recommandé) :**

```ts
import { AppRouter } from '../router'

export const GameOverSystem = defineSystem(() => {
  const nav = useSceneRouter(AppRouter)

  onUpdate(() => {
    if (noLivesRemaining) {
      nav.send('GAME_OVER')
    }
  })
})
```

**Depuis un plugin local (`src/plugins/`) :**

Quand le système qui navigue fait partie d'une scène référencée par le router, importer `AppRouter` créerait une dépendance circulaire. Câblez la navigation dans un plugin local à la place — il se situe en dehors du graphe de scènes :

```ts
// src/plugins/navigation.ts
import { useSceneRouter } from '@gwenjs/core/scene'
import { useHook } from '@gwenjs/core'
import { AppRouter } from '../router'

export default () => ({
  name: 'app:navigation',
  setup() {
    const nav = useSceneRouter(AppRouter)
    useHook('nav:toGame', () => nav.send('START'))
  },
})
```

La scène émet simplement l'événement sans connaître le router :

```ts
// src/systems/TitleSystem.ts
export const TitleSystem = defineSystem(() => {
  const kb = useKeyboard()
  onUpdate(() => {
    if (kb.isPressed(Keys.Space)) emit('nav:toGame')
  })
})
```

::: warning Piège de la dépendance circulaire
`router.ts` importe vos fichiers de scènes. Si une scène (ou quelque chose qu'elle importe) importe également `router.ts`, vous obtenez une dépendance circulaire ES module → `ReferenceError: Cannot access before initialization`.

**Règle :** les scènes et leurs systèmes ne doivent jamais importer `router.ts`. Placez le câblage de navigation dans `src/plugins/` ou dans des systèmes qui ne sont pas importés transitivement par le router.
:::

**Lire les paramètres depuis une scène :**

```ts
export const GameScene = defineScene('game', () => {
  onEnter((params) => {
    const level = params?.level  // passé par nav.send('START', { level: 2 })
  })
})
```

## API du handle

| | |
|---|---|
| `nav.send(event, params?)` | Déclencher une transition (async) |
| `nav.can(event)` | Vérifier si la transition est valide dans l'état actuel |
| `nav.current` | Nom de l'état actuel |
| `nav.params` | Paramètres passés à l'état actuel |
| `nav.onTransition(fn)` | S'abonner aux changements d'état ; retourne une fonction de désabonnement |

## Passer des paramètres

Passez des données lors du déclenchement d'une transition. Lisez-la dans la scène cible via `nav.params` ou dans `onEnter(params)` :

```ts
// Déclencher avec des paramètres
nav.send('START', { level: 2, difficulty: 'hard' })

// Lire dans la scène cible via le callback onEnter
export const GameScene = defineScene('game', () => {
  onEnter((params) => {
    console.log('Level:', params?.level)
  })
})

// Ou via nav.params
const nav = useSceneRouter(AppRouter)
onEnter(() => {
  const { level } = nav.params
})
```

## Scènes superposées

Définissez `overlay: true` pour garder la scène précédente chargée et rendue derrière la nouvelle :

```ts
export const AppRouter = defineSceneRouter({
  initial: 'game',
  routes: {
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
    pause: {
      scene: PauseScene,
      overlay: true,
      on: { RESUME: 'game' },
    },
  },
})
```

Lors de la transition vers `pause` :
- La scène du jeu **reste chargée** (les systèmes continuent de s'exécuter)
- `onExit` n'est **pas appelé** sur la scène du jeu
- `onEnter` **est appelé** sur la scène de pause

Quand vous revenez de `pause` :
- `onExit` est appelé sur la scène de pause
- La scène du jeu **reprend immédiatement** (`onEnter` n'est pas appelé à nouveau)

## Écouter les transitions

`nav.onTransition(fn)` s'abonne à tous les changements d'état. Elle retourne une fonction de désabonnement :

```ts
const unsubscribe = nav.onTransition((from, to, params) => {
  console.log(`Transitioned from ${from} to ${to}`)
})

// Plus tard, pour arrêter l'écoute :
unsubscribe()
```

## Animations de transition

Pour jouer des animations autour des changements de scène, utilisez `onTransitionLeave` et `onTransitionEnter` dans la scène. Voir [Scènes — Animations de transition](/fr/essentials/scenes#animations-de-transition).

## Validation

`defineSceneRouter()` valide au moment de la définition :
- `initial` doit être une clé dans `routes`
- Toutes les cibles de transition doivent être des clés de route valides

Les erreurs sont levées immédiatement au démarrage du développement, pas au runtime.

## Résumé de l'API

| | |
|---|---|
| `defineSceneRouter(options)` | Déclarer la FSM avec les routes et l'état initial |
| `useSceneRouter(router)` | Obtenir le handle au runtime (contexte système ou scène) |
| `nav.send(event, params?)` | Déclencher une transition (async) |
| `nav.can(event)` | Vérifier si la transition est valide |
| `nav.current` | Nom de l'état actuel |
| `nav.params` | Paramètres passés à l'état actuel |
| `nav.onTransition(fn)` | S'abonner aux changements d'état ; retourne une fonction de désabonnement |

## Étapes suivantes

- **[Scènes](/fr/essentials/scenes)** — Hooks de cycle de vie et d'animation de transition.
- **[Systèmes](/fr/essentials/systems)** — Naviguer depuis les systèmes.
- **[Hooks](/fr/essentials/hooks)** — Réagir aux événements `scene:enter` et `scene:leave`.
