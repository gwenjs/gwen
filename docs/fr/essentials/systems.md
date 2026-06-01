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

## Setup vs Runtime

Le corps de la factory de `defineSystem` s'exécute **une seule fois** à l'installation du système — c'est la *phase de setup*. Les callbacks de frame (`onUpdate`, etc.) s'exécutent à chaque frame — c'est la *phase d'exécution*.

```ts
export const MovementSystem = defineSystem(() => {

  // ── Phase de setup (une fois à l'installation) ──────────────────
  const entities = useQuery([Position, Velocity])  // requête live, mise à jour automatique
  const audio    = useService('audio')             // résolu une seule fois

  // ── Phase d'exécution (chaque frame) ────────────────────────────
  onUpdate((dt) => {
    for (const entity of entities) {
      Position.x[entity.id] += Velocity.x[entity.id] * dt
    }
  })
})
```

`defineSystem()` retourne une **fonction factory** — appelez-la pour produire un plugin, puis passez-le à `useSystem()` dans une scène :

```ts
// Dans une scène :
useSystem(MovementSystem())
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

## Lire et écrire un composant individuel

`useComponentFor(entityId, Def)` retourne un proxy mutable pour le composant d'une entité spécifique. Lire un champ lit depuis le stockage ECS ; écrire un champ appelle `addComponent` pour persister le changement. Utilisez `$set({ ... })` pour grouper plusieurs champs en une seule écriture.

```ts
export const InputSystem = defineSystem(() => {
  const players = useQuery([Position, Velocity, PlayerTag])

  onUpdate((dt) => {
    for (const entity of players) {
      const pos = useComponentFor(entity.id, Position)
      const vel = useComponentFor(entity.id, Velocity)

      vel.vx = kb.isPressed(Keys.Left) ? -200 : kb.isPressed(Keys.Right) ? 200 : 0
      pos.x = Math.max(0, Math.min(800, pos.x + vel.vx * dt))

      // Écriture groupée — un seul appel ECS pour les deux champs :
      pos.$set({ x: pos.x + vel.vx * dt, y: pos.y + vel.vy * dt })
    }
  })
})
```

::: tip Optimizer
`useComponentFor` dans une boucle `for...of` sur un query est détecté par l'optimizer Vite de GWEN et réécrit automatiquement en appels WASM groupés. Écrivez du code clair — l'optimizer gère la performance.
:::

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
| `useComponentFor(id, Def)` | Proxy mutable pour le composant d'une entité ; `.field` lit, `.field = v` écrit, `.$set({...})` groupe |
| `onBeforeUpdate(fn)` | Callback de frame avant la mise à jour |
| `onUpdate(fn)` | Callback de frame de mise à jour principale |
| `onAfterUpdate(fn)` | Callback de frame après la mise à jour |
| `onRender(fn)` | Callback de frame de rendu |
| `useService(key)` | Accéder à un service fourni par un plugin |
| `useHook(name, fn)` | S'abonner à un événement — `import { useHook } from '@gwenjs/core'` |
| `useActor(def)` | Spawn/despawn d'instances d'acteur |
| `useSceneRouter(router)` | Accéder au handle du routeur de scènes |
| `SystemHandle.pause()` | Mettre en pause les callbacks de frame |
| `SystemHandle.resume()` | Reprendre les callbacks de frame |
| `SystemHandle.destroy()` | Supprimer définitivement le système |
| `SystemHandle.active` | `true` si le système est en cours d'exécution |

## Étapes suivantes

- **[Acteurs](/fr/essentials/actors)** — Objets de jeu par instance avec leur propre cycle de vie.
- **[Scènes](/fr/essentials/scenes)** — Inscrivez les systèmes et contrôlez-les à l'exécution.
- **[Hooks](/fr/essentials/hooks)** — Définissez et utilisez des événements typés personnalisés.
