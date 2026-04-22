---
title: Systèmes
description: Les systèmes contiennent toute la logique de jeu dans GWEN. Apprenez à les définir, à interroger les entités et à utiliser tous les composables du contexte système.
---

# Systèmes

Un **système** est une fonction qui s'exécute à chaque frame et lit/écrit les données des composants. Les systèmes sont la couche de logique de jeu de l'ECS de GWEN.

::: info Auto-imports
Dans un projet GWEN, les composables sont disponibles sans aucune ligne `import` — le framework génère les déclarations de types globaux au moment du build. Vous écrivez `defineSystem(...)`, `useQuery(...)`, `onUpdate(...)` directement, sans import.

Une exception nécessite un import explicite :
```ts
import { useHook, emit } from '@gwenjs/core'  // système d'événements
```
:::

## Les bases

Utilisez `defineSystem()` pour déclarer un système. Il retourne une **fonction factory** — vous l'appelez pour produire un plugin, puis vous passez ce plugin à `useSystem()` dans une scène.

```ts
export const ClockSystem = defineSystem(() => {
  let elapsed = 0

  onUpdate((dt) => {
    elapsed += dt
  })
})

// Dans une scène :
useSystem(ClockSystem())
```

## Interroger des entités

Utilisez `useQuery()` pour obtenir une collection live d'entités ayant un ensemble spécifique de composants. La requête se met à jour automatiquement lorsque des entités sont créées ou détruites.

```ts
import { Position, Velocity } from './components'

export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const entity of entities) {
      Position.x[entity.id] += Velocity.x[entity.id] * dt
      Position.y[entity.id] += Velocity.y[entity.id] * dt
    }
  })
})
```

`entity.id` est un `bigint` utilisé pour indexer directement les tableaux typés du composant. Pour lire un composant comme un objet simple, utilisez `entity.get(def)` :

```ts
onUpdate(() => {
  for (const entity of entities) {
    const pos = entity.get(Position) // { x: number, y: number } | undefined
  }
})
```

## Phases de frame

Enregistrez les callbacks dans la phase correcte selon votre cas d'usage :

| Composable | Phase | Usage typique |
|---|---|---|
| `onBeforeUpdate(fn)` | Avant physique/WASM | Lecture des entrées, pré-simulation |
| `onUpdate(fn)` | Mise à jour principale | Logique de jeu, IA, mouvement |
| `onAfterUpdate(fn)` | Post-mise à jour | Synchronisation d'état, score |
| `onRender(fn)` | Rendu | Appels de dessin (pas de `dt`) |

```ts
export const InputSystem = defineSystem(() => {
  onBeforeUpdate((dt) => { /* lire les entrées */ })
  onUpdate((dt)       => { /* appliquer le mouvement */ })
  onAfterUpdate((dt)  => { /* mettre à jour le HUD debug */ })
  onRender(()         => { /* dessiner l'overlay debug */ })
})
```

## Injection de dépendances

Les systèmes déclarent des dépendances typées en paramètres. La scène les fournit au moment de l'initialisation, gardant le système découplé des implémentations concrètes.

```ts
export const CombatSystem = defineSystem((target: { takeDamage(n: number): void }) => {
  onUpdate(() => target.takeDamage(5))
})
```

Dans la scène, passez la valeur concrète :

```ts
const player = useActor(PlayerActor)
useSystem(CombatSystem(player))  // player satisfait l'interface
```

## Accéder aux services

Utilisez `useService(key)` pour accéder à une valeur fournie par un plugin. Résolu une fois au moment de l'initialisation, utilisé en closure dans les callbacks.

```ts
export const AudioSystem = defineSystem(() => {
  const audio = useService('audio')  // fourni par un plugin audio

  onUpdate(() => {
    // utiliser le service audio
  })
})
```

## Écouter des événements

Utilisez `useHook()` pour vous abonner à un événement moteur ou de jeu. L'abonnement est automatiquement supprimé quand la scène se termine.

```ts
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(() => {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
  })

  useHook('player:scored', (points: number) => {
    score += points
  })
})
```

::: info Import explicite requis
`useHook` et `emit` ne sont pas auto-importés — importez-les toujours depuis `@gwenjs/core`.
:::

## Utiliser des acteurs dans un système

Utilisez `useActor(def)` dans le corps d'un système pour obtenir un handle de spawn et de despawn d'instances d'acteur. GWEN auto-découvre et installe le plugin d'acteur — aucune déclaration séparée dans la scène n'est nécessaire.

```ts
import { AsteroidActor } from './actors/asteroid'

export const SpawnSystem = defineSystem(() => {
  const asteroid = useActor(AsteroidActor)

  onUpdate((dt) => {
    if (shouldSpawn) {
      asteroid.spawn({ x: randomX(), y: -10 })
    }
  })
})
```

## Naviguer entre les scènes

Utilisez `useSceneRouter(router)` pour accéder au routeur de scènes depuis un système. Appelez `nav.send()` pour déclencher des transitions.

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

## Nommage des systèmes

Le moteur utilise un nom pour la déduplication et le débogage. Avec `gwenVitePlugin`, le nom est **injecté automatiquement** depuis le nom de la variable exportée. Sans le plugin Vite (tests, Node.js), passez-le explicitement :

```ts
// ✅ Avec le plugin Vite — nom inféré depuis export const
export const MovementSystem = defineSystem(() => { ... })

// ✅ Sans le plugin Vite — nom explicite
export const MovementSystem = defineSystem('MovementSystem', () => { ... })
```

## SystemHandle — Contrôle du cycle de vie

`useSystem()` retourne un `SystemHandle` :

```ts
const combat = useSystem(CombatSystem(player))

combat.pause()            // arrêter les callbacks de frame, préserver l'état
combat.resume()           // redémarrer les callbacks
combat.destroy()          // supprimer définitivement de la boucle de frame
combat.active             // booléen — true si en cours d'exécution
```

::: warning Pause manuelle et superpositions de scènes
Si une superposition de scène (ex : un menu pause) fige la scène sous-jacente, les systèmes sont automatiquement mis en pause par le moteur. Un système que vous avez mis en pause manuellement **ne sera pas** réactivé à la fermeture de la superposition — seule la mise en pause de la scène par le moteur est levée. Appelez `combat.resume()` explicitement quand votre cinématique se termine.
:::

## Résumé de l'API

| | |
|---|---|
| `defineSystem(factory)` | Déclare un système |
| `useQuery([...defs])` | Collection live d'entités correspondant aux composants donnés |
| `entity.id` | ID d'entité (`bigint`) pour l'accès aux tableaux SoA |
| `entity.get(def)` | Lire un composant comme un objet simple |
| `onBeforeUpdate(fn)` | Callback de frame avant la mise à jour |
| `onUpdate(fn)` | Callback de frame de mise à jour principale |
| `onAfterUpdate(fn)` | Callback de frame après la mise à jour |
| `onRender(fn)` | Callback de frame de rendu |
| `useService(key)` | Accéder à un service fourni par un plugin |
| `useHook(name, fn)` | S'abonner à un événement — `import { useHook } from '@gwenjs/core'` |
| `useActor(def)` | Spawn/despawn d'instances d'acteur |
| `usePrefab(def)` | Spawn/despawn d'entités prefab |
| `useSceneRouter(router)` | Accéder au handle du routeur de scènes |
| `SystemHandle.pause()` | Mettre en pause les callbacks de frame |
| `SystemHandle.resume()` | Reprendre les callbacks de frame |
| `SystemHandle.destroy()` | Supprimer définitivement le système |
| `SystemHandle.active` | `true` si le système est en cours d'exécution |

## Étapes suivantes

- **[Acteurs](/fr/essentials/actors)** — Objets de jeu par instance avec leur propre cycle de vie.
- **[Scènes](/fr/essentials/scenes)** — Inscrivez les systèmes et contrôlez-les à l'exécution.
- **[Hooks](/fr/essentials/hooks)** — Définissez et utilisez des événements typés personnalisés.
