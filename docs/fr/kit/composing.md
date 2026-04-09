---
title: Composer des plugins
description: Combinez plusieurs plugins avec des dépendances et des capacités optionnelles.
---

# Composer des plugins

Les vrais jeux ont souvent besoin de plusieurs plugins qui fonctionnent ensemble. Ce guide montre comment composer des plugins qui dépendent les uns des autres, gérer les dépendances optionnelles et gérer l'ordre d'initialisation.

## Les bases

### Ordre des plugins

Les plugins sont enregistrés dans `main.ts` avec `engine.use()`. **Les dépendances doivent être enregistrées avant les plugins qui en dépendent.**

```ts
import { createEngine } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'
import { AudioPlugin } from './plugins/audio'
import { GamePlugin } from './plugins/game' // Depends on Input and Audio

const engine = await createEngine()

// Register in dependency order
await engine.use(InputPlugin())      // Registered first
await engine.use(AudioPlugin())      // Registered second
await engine.use(GamePlugin())       // Registered third — can use Input and Audio

await engine.start()
```

### Dépendances optionnelles

Vérifiez si un autre service existe avant de l'utiliser :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      // Audio is optional — only use if available
      const audio = engine.get('audio')
      if (audio) {
        audio.play('game-music')
      }

      // Input is required
      const input = engine.get('input')
      if (!input) {
        throw new Error('InputPlugin must be registered before GamePlugin')
      }
    })
  },
}))
```

### Dépendance du plugin dans setup()

Certains plugins peuvent enregistrer d'autres plugins pendant leur configuration :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { PhysicsPlugin } from './physics'
import { CollisionPlugin } from './collision'

export const PhysicsSystemPlugin = definePlugin(() => ({
  name: 'physics-system',
  setup(engine) {
    // Register dependent plugins within setup
    engine.use(PhysicsPlugin())
    engine.use(CollisionPlugin())

    engine.hooks.hook('engine:init', () => {
      // Now you can safely use physics and collision services
      const physics = engine.get('physics')
      const collision = engine.get('collision')
    })
  },
}))
```

Puis dans `main.ts` :

```ts
import { createEngine } from '@gwenjs/core'
import { PhysicsSystemPlugin } from './plugins/physics-system'

const engine = await createEngine()
await engine.use(PhysicsSystemPlugin())
await engine.start()
```

## En pratique

### Exemple de composition de plugin complexe

Voici un exemple réaliste : un jeu basé sur la physique qui utilise l'entrée, l'audio, la simulation physique et l'interface utilisateur.

**Plugin d'entrée :**

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

const keys = new Set<string>()

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })

    engine.provide('input', {
      isKeyDown: (k: string) => keys.has(k),
    })
  },
}))
```

**Plugin de physique :**

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export const Physics2DPlugin = definePlugin<{ gravity?: number }>((opts = {}) => ({
  name: 'physics2d',
  setup(engine) {
    const gravity = opts.gravity ?? 9.81
    const bodies = new Map()

    engine.provide('physics2d', {
      addBody: (id: string, mass: number) => {
        bodies.set(id, { mass, vx: 0, vy: 0 })
      },
      applyForce: (id: string, fx: number, fy: number) => {
        const body = bodies.get(id)
        if (body) {
          body.vx += fx / body.mass
          body.vy += fy / body.mass
        }
      },
      getPosition: (id: string) => bodies.get(id),
      step: (deltaTime: number) => {
        bodies.forEach((body) => {
          body.vy += gravity * deltaTime // Apply gravity
        })
      },
    })
  },
}))
```

**Plugin de jeu** (compose Input et Physics) :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { InputPlugin } from './input'
import { Physics2DPlugin } from './physics'

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  setup(engine) {
    // Register required dependencies
    engine.use(InputPlugin())
    engine.use(Physics2DPlugin({ gravity: 15 }))

    engine.hooks.hook('engine:init', () => {
      const input = engine.get('input')
      const physics = engine.get('physics2d')

      // Initialize game state
      physics.addBody('player', 1.0)

      engine.hooks.hook('engine:stop', () => {
        console.log('Game plugin shutting down')
      })
    })
  },
}))
```

**Configuration dans `gwen.config.ts` :**

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/game-framework'],
})
```

**Enregistrement dans `main.ts` :**

```ts
import { createEngine } from '@gwenjs/core'
import { GamePlugin } from './plugins/game'

const engine = await createEngine()
await engine.use(GamePlugin()) // Internally registers Input and Physics
await engine.start()
```

### Gestion gracieuse des dépendances manquantes

Utilisez un modèle de détection de fonctionnalité pour les capacités vraiment optionnelles :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export const DebugUIPlugin = definePlugin(() => ({
  name: 'debug-ui',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      const physics = engine.get('physics2d')

      if (physics) {
        // Physics is available — show physics debug overlay
        console.log('[DebugUI] Physics visualization enabled')
      } else {
        console.log('[DebugUI] Physics plugin not found, skipping physics debug')
      }

      const audio = engine.get('audio')
      if (audio) {
        console.log('[DebugUI] Audio debug panel enabled')
      }
    })
  },
}))
```

## Directives d'ordre des plugins

1. **Infrastructure d'abord** — Input, Audio, plugins spécifiques à la plateforme
2. **Simulation ensuite** — Physics, Animation, AI
3. **Logique du jeu en dernier** — Plugins spécifiques au jeu qui utilisent les éléments ci-dessus
4. **Interface utilisateur et débogage en dernier** — Debug, plugins d'interface utilisateur qui interrogent plusieurs services

Exemple dans `main.ts` :

```ts
import { createEngine } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'
import { AudioPlugin } from './plugins/audio'
import { Physics2DPlugin } from '@gwenjs/physics2d'

const engine = await createEngine()

// Infrastructure
await engine.use(InputPlugin())
await engine.use(AudioPlugin())

// Simulation
await engine.use(Physics2DPlugin({ gravity: 9.81 }))

// Game
await engine.use(GamePlugin())

// Debug (optional)
if (isDevelopment) {
  await engine.use(DebugPlugin({ showPhysics: true }))
}

await engine.start()
```

## Utiliser les modules pour les compositions de plugins complexes

Pour les compositions de plugins complexes, utilisez `defineGwenModule()` pour tout empaqueter :

```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'
import { InputPlugin } from './input'
import { Physics2DPlugin } from './physics'

const GamePlugin = definePlugin(() => ({
  name: 'game',
  setup(engine) {
    engine.use(InputPlugin())
    engine.use(Physics2DPlugin({ gravity: 15 }))
  },
}))

export default defineGwenModule({
  meta: {
    name: '@my-scope/game-framework',
    configKey: 'gameFramework',
  },
  setup(options, gwen) {
    gwen.addPlugin(GamePlugin())
    gwen.addAutoImports([
      { name: 'useInput', from: '@my-scope/game-framework' },
      { name: 'usePhysics2D', from: '@my-scope/game-framework' },
    ])
  },
})
```

## Gestion des erreurs dans les chaînes de plugins

Si un plugin ne s'initialise pas, les plugins en aval n'auront pas accès à son service :

```ts
export const CriticalGamePlugin = definePlugin(() => ({
  name: 'critical-game',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      const physics = engine.get('physics2d')

      if (!physics) {
        throw new Error(
          'CriticalGamePlugin requires physics2d plugin to be registered first'
        )
      }
    })
  },
}))
```

## Meilleures pratiques

### 1. **Déclarez les dépendances clairement**

Documentez quels services un plugin a besoin :

```ts
/**
 * GamePlugin
 *
 * **Required dependencies:**
 * - `input` (InputPlugin)
 * - `physics2d` (Physics2DPlugin)
 *
 * **Optional dependencies:**
 * - `audio` (AudioPlugin)
 */
export const GamePlugin = definePlugin(() => ({
  name: 'game',
  setup(engine) { /* ... */ },
}))
```

### 2. **Vérifiez les dépendances manquantes**

```ts
engine.hooks.hook('engine:init', () => {
  const requiredService = engine.get('required')
  if (!requiredService) {
    throw new Error('Required service not found')
  }
})
```

### 3. **Utilisez les modules pour les compositions complexes**

Si vous avez plusieurs plugins qui vont toujours ensemble, empaquetez-les dans un module.

### 4. **Testez l'ordre des plugins**

Testez toujours vos plugins dans l'ordre prévu :

```ts
export default defineConfig({
  plugins: [
    InputPlugin(),
    GamePlugin(), // Requires Input
    DebugPlugin(), // Queries both
  ],
})
```

## Résumé de l'API

### Méthodes GwenEngine pour la composition

| Méthode | But |
|---------|-----|
| `use(plugin)` | Enregistrez un plugin lors de la configuration d'un autre plugin |
| `get(key)` | Récupérez un service enregistré (retourne `undefined` s'il n'est pas trouvé) |
| `provide(key, service)` | Enregistrez un service |
| `onStart(cb)` | Hook appelé après le chargement de WASM |
| `onDestroy(cb)` | Hook appelé avant l'arrêt |

### Ordre d'enregistrement des plugins

1. Listez les plugins dans `defineConfig({ plugins: [...] })`
2. Les plugins sont enregistrés dans l'ordre
3. La `setup()` de chaque plugin s'exécute séquentiellement
4. Ce n'est qu'après la configuration de tous les plugins que les systèmes peuvent accéder en toute sécurité aux services

### Meilleur modèle pour les dépendances

```ts
// Define plugin with required and optional dependencies
const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      const required = engine.get('required')
      const optional = engine.get('optional')

      if (!required) {
        throw new Error('Required plugin not registered')
      }

      if (optional) {
        // Use optional feature
      }
    })
  },
}))
```

Puis dans `main.ts` :

```ts
const engine = await createEngine()
await engine.use(RequiredPlugin())
await engine.use(MyPlugin())
await engine.start()
```
