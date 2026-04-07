---
title: Hooks et événements
description: S'abonner aux événements du cycle de vie du moteur et aux événements de jeu avec nettoyage automatique.
---

# Hooks et événements

Les hooks sont un moyen de réagir à des moments spécifiques dans la vie de votre jeu — quand le moteur démarre, quand une entité apparaît, quand un événement de jeu personnalisé se déclenche. N'importe quelle partie de votre code peut s'abonner à ces moments sans couplage étroit, et les abonnements se nettoient automatiquement quand votre acteur ou système se termine.

## Pourquoi les hooks ?

Les systèmes traitent les données chaque frame. Mais parfois, vous devez réagir à un *moment spécifique* plutôt que de vérifier une condition à chaque tick. Une entité vient-elle d'apparaître ? Le joueur a-t-il perdu ? Un plugin s'est-il enregistré ?

Les hooks découplent ces réactions. Au lieu de coder en dur « quand le jeu démarre, faire X », vous déclarez « je veux écouter engine:start et faire X » — et si l'écouteur est supprimé, l'abonnement disparaît automatiquement. Pas de nettoyage manuel. Pas de références qui traînent.

## useHook()

L'API principale est `useHook()`. Appelez-la à l'intérieur d'un contexte moteur actif pour vous abonner à un événement :

```typescript
import { useHook } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

export const LoggingSystem = defineSystem(function LoggingSystem() {
  useHook('engine:start', () => {
    console.log('Game started!')
  })

  useHook('entity:spawn', (id) => {
    console.log('Entity spawned:', id)
  })
})
```

Le handler reçoit des arguments correspondant à la signature de l'événement. Pour `entity:spawn`, l'ID d'entité. Pour `engine:tick`, le delta time.

### Nettoyage automatique

Quand vous appelez `useHook()` à l'intérieur d'un contexte de cycle de vie — une factory d'acteur, un système ou une configuration de plugin — l'abonnement est automatiquement supprimé quand le contexte se termine. Pas d'appels de désabonnement nécessaires.

Dans un **acteur** :

```typescript
import { defineActor, useHook } from '@gwenjs/core/actor'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  useHook('engine:tick', (dt) => {
    console.log('Frame:', dt)
  })

  // Automatically cleaned up when this actor is despawned
  return {}
})
```

Dans un **système** :

```typescript
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const TrackingSystem = defineSystem(function TrackingSystem() {
  useHook('entity:spawn', (id) => {
    console.log('New entity:', id)
  })

  // Automatically cleaned up when the engine stops
})
```

Dans une **configuration de plugin** :

```typescript
import { withCleanup } from '@gwenjs/core'

export const MyPlugin = {
  setup() {
    const [, dispose] = withCleanup(() => {
      useHook('engine:start', () => {
        console.log('Plugin setup complete')
      })
      return {}
    })
    // dispose() called when plugin tears down
  }
}
```

Ou depuis `engine.run()` :

```typescript
engine.run(() => {
  useHook('engine:tick', (dt) => {
    console.log('Running...')
  })
})
```

### Désabonnement manuel

`useHook()` retourne une fonction de désabonnement. Appelez-la pour supprimer l'écouteur plus tôt, avant la fin du contexte :

```typescript
const unsubscribe = useHook('engine:tick', (dt) => {
  if (someCondition) {
    console.log('Stopping listener')
    unsubscribe() // Remove now, don't wait for context cleanup
  }
})
```

## Référence des hooks d'exécution

Ce sont les événements du cycle de vie du moteur auxquels vous pouvez vous abonner. Tous se déclenchent automatiquement ; vous écoutez simplement.

| Événement | Signature | Se déclenche quand |
|---|---|---|
| `engine:init` | `() => void` | La configuration du moteur se termine, avant le début de la boucle RAF |
| `engine:start` | `() => void` | `engine.start()` appelé ; la boucle RAF commence |
| `engine:stop` | `() => void` | `engine.stop()` appelé ; le nettoyage commence |
| `engine:tick` | `(dt: number) => void` | Chaque frame commence (dt en millisecondes) |
| `engine:afterTick` | `(dt: number) => void` | Chaque frame se termine (après la phase de rendu) |
| `engine:error` | `(payload: EngineErrorPayload) => void` | La boucle de frames capture une erreur non gérée |
| `entity:spawn` | `(id: EntityId) => void` | Entité créée |
| `entity:destroy` | `(id: EntityId) => void` | Entité supprimée |
| `plugin:registered` | `(pluginName: string) => void` | La configuration du plugin se termine et s'enregistre |
| `plugin:error` | `(payload: PluginErrorPayload) => void` | Le hook de cycle de vie du plugin lance et n'est pas récupéré |
| `prefab:instantiate` | `(entityId: EntityId, extensions: GwenPrefabExtensions) => void` | Entité créée à partir d'un préfabriqué (utilisé en interne par les plugins comme Physics2D) |

## onCleanup()

`useHook()` utilise `onCleanup()` sous le capot. `onCleanup()` est la primitive sous-jacente pour toute logique de nettoyage — pas seulement les hooks.

Utilisez `onCleanup()` pour enregistrer un callback de nettoyage qui se déclenche quand le contexte de cycle de vie actuel se termine :

```typescript
import { onCleanup } from '@gwenjs/core'
import { defineActor } from '@gwenjs/core/actor'
import { PlayerPrefab } from '../prefabs'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const timer = setInterval(() => {
    console.log('Tick')
  }, 1000)

  onCleanup(() => {
    clearInterval(timer) // Called when actor despawns
  })

  return {}
})
```

Écrivez des composables réutilisables en combinant `onCleanup()` avec d'autres APIs :

```typescript
import { onCleanup } from '@gwenjs/core'

// Custom auto-cleanup composable
function useWindowResize(fn: (e: UIEvent) => void) {
  window.addEventListener('resize', fn)
  onCleanup(() => window.removeEventListener('resize', fn))
}

// Works in any lifecycle context
import { defineActor } from '@gwenjs/core/actor'

const MyActor = defineActor(MyPrefab, () => {
  useWindowResize((e) => {
    console.log('Window resized to', e)
  })

  // Auto-removed when the actor despawns
  return {}
})
```

## Événements de jeu personnalisés

Déclarez les événements de votre jeu en un seul endroit. Définissez-les avec `defineEvents()`, augmentez `GwenRuntimeHooks` via la fusion de déclaration TypeScript, et profitez de la sécurité de type complète partout où vous émettez ou écoutez.

### Définition des événements

Créez un fichier partagé avec vos types d'événements personnalisés :

```typescript
// src/events.ts
import { defineEvents } from '@gwenjs/core/actor'
import type { InferEvents } from '@gwenjs/core/actor'

export const GameEvents = defineEvents({
  'enemy:hit': (damage: number) => {},
  'enemy:die': (entityId: bigint) => {},
  'player:score': (points: number) => {},
})

// Augment GwenRuntimeHooks for type safety across the project
declare module '@gwenjs/core' {
  interface GwenRuntimeHooks extends InferEvents<typeof GameEvents> {}
}
```

`defineEvents()` est un outil de déclaration — il n'exécute aucun code à l'exécution. Sa valeur est la signature TypeScript. Associez-le à `InferEvents` pour plier vos événements personnalisés dans `GwenRuntimeHooks`.

### Émission d'événements

Appelez `emit()` depuis à l'intérieur d'un acteur ou d'un système pour déclencher un événement :

```typescript
import { defineActor, emit } from '@gwenjs/core/actor'
import { EnemyPrefab } from '../prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  let hp = props.hp

  return {
    takeDamage: (damage: number) => {
      hp -= damage
      emit('enemy:hit', damage)
      if (hp <= 0) {
        emit('enemy:die', BigInt(Date.now()))
      }
    },
  }
})
```

### Écoute des événements

Écoutez depuis un acteur avec `onEvent()` :

```typescript
import { defineActor, onEvent } from '@gwenjs/core/actor'
import { HUDPrefab } from '../prefabs'

export const HUDActor = defineActor(HUDPrefab, () => {
  let hits = 0

  onEvent('enemy:hit', (damage) => {
    hits++
    console.log(`Hit for ${damage} (total: ${hits})`)
  })

  onEvent('enemy:die', (id) => {
    console.log('Enemy eliminated')
  })

  // Automatically cleaned up when the actor despawns
  return {}
})
```

Écoutez depuis un système avec `useHook()` :

```typescript
import { defineSystem } from '@gwenjs/core/system'
import { useHook } from '@gwenjs/core'

export const ScoreSystem = defineSystem(function ScoreSystem() {
  let score = 0

  useHook('enemy:die', () => {
    score += 100
    console.log('Score:', score)
  })

  useHook('enemy:hit', (damage) => {
    score += damage
  })

  // Automatically cleaned up when the engine stops
})
```

::: tip Convention de nommage
Préfixez les noms d'événements avec un espace de noms pour éviter les collisions avec les hooks moteur intégrés :

- ✅ `'enemy:hit'`, `'player:die'`, `'ui:open'`
- ❌ `'hit'`, `'die'`, `'open'`

Les hooks intégrés utilisent les préfixes `engine:` et `entity:`, donc tout le reste est sûr, mais l'espace de noms rend l'intention claire.
:::

## Hooks de build

Les hooks de build se déclenchent lors du démarrage du build/serveur de développement dans les environnements Node.js. Ils sont utilisés par les modules pour s'intégrer à la configuration Vite ou effectuer une configuration avant le chargement du jeu.

**Les hooks de build sont uniquement Node.js** — ils ne se déclenchent pas dans le navigateur.

| Événement | Se déclenche quand |
|---|---|
| `build:before` | Avant l'exécution de toute configuration de module |
| `build:done` | Tous les modules ont été configurés ; le build est complet |
| `module:before` | La configuration d'un module unique est sur le point de s'exécuter |
| `module:done` | La configuration d'un module unique se termine |
| `vite:extendConfig` | Un module étend la configuration de Vite |

Utilisez-les dans `gwen.config.ts` :

```typescript
// gwen.config.ts
import { defineGwenConfig } from '@gwenjs/app'

export default defineGwenConfig({
  hooks: {
    'build:before': () => {
      console.log('Build starting')
    },
    'build:done': () => {
      console.log('Build complete')
    },
  }
})
```

Ou s'abonnez depuis la configuration `setup()` d'un module :

```typescript
import { defineGwenModule } from '@gwenjs/kit'

export default defineGwenModule({
  meta: { name: 'my-module' },
  setup(_opts, gwen) {
    gwen.hook('build:done', () => {
      console.log('Module initialized')
    })
  }
})
```

## onEvent() vs useHook()

Les deux écoutent les événements, mais ils sont optimisés pour des contextes différents :

| | `onEvent()` | `useHook()` |
|---|---|---|
| **Contexte** | Factory d'acteur uniquement | Acteur, système, configuration de plugin, `engine.run()` |
| **Nettoyage automatique** | ✅ À la disparition de l'acteur | ✅ À la fin du contexte |
| **Import** | `@gwenjs/core/actor` | `@gwenjs/core` |
| **Cas d'usage** | Abonnements aux événements locaux à l'acteur | Abonnements intersectoriels depuis les systèmes |
| **Raccourci ?** | Oui, spécifique aux acteurs | Non, universel |

Utilisez `onEvent()` à l'intérieur des acteurs pour la brièveté. Utilisez `useHook()` partout ailleurs, ou quand vous avez besoin d'écouter depuis un système.

## Résumé de l'API

| Symbole | Description |
|---|---|
| `useHook(event, handler)` | S'abonner à un événement moteur ou personnalisé (nettoyage automatique) |
| `onCleanup(fn)` | Enregistrer un callback de nettoyage dans le contexte de cycle de vie actif |
| `defineEvents(map)` | Déclarer un contrat d'événements typé (retourne le même objet à l'exécution) |
| `InferEvents<T>` | Aide de type pour extraire les signatures d'événements d'une carte retournée par `defineEvents()` |
| `emit(event, ...args)` | Déclencher un événement depuis à l'intérieur d'un acteur ou d'un système |
| `onEvent(event, handler)` | Écouter un événement à l'intérieur d'un acteur (raccourci pour `useHook()`) |
| `GwenRuntimeHooks` | L'interface de tous les événements du cycle de vie du moteur (augmentée par les plugins et les événements personnalisés via la fusion de déclaration) |
