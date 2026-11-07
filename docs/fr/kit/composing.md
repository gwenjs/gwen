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
import { setupGwen } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'
import { AudioPlugin } from './plugins/audio'
import { GamePlugin } from './plugins/game' // Depends on Input and Audio

const engine = await setupGwen()

// Register in dependency order
await engine.use(InputPlugin())      // Registered first
await engine.use(AudioPlugin())      // Registered second
await engine.use(GamePlugin())       // Registered third — can use Input and Audio

await engine.start()
```

### Dépendances optionnelles

Nommez dans `requires` ce qui doit être installé, et lisez les services optionnels avec `optionalService` ou `tryInject`. Un nom dans `plugins` est un `GwenPluginName` : le plugin que les autres nomment augmente `GwenPluginRegistry`. Sur le moteur que reçoit `setup()`, les deux sont typés par `GwenProvides`, que le plugin fournisseur du service augmente. `tryInject` renvoie `GwenProvides[K] | undefined` :

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides { audio: { play(track: string): void } }
  interface GwenPluginRegistry { input: {} }
}

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  // Input est requis : engine.use() rejette sans lui
  requires: { plugins: ['input'], optional: ['audio'] },
  setup(engine) {
    const audio = optionalService(engine, 'audio')
    engine.hooks.hook('engine:init', () => {
      // Audio est optionnel : `current` vaut undefined s'il est absent
      audio.current?.play('game-music')
    })
  },
}))
```

Si `input` n'est pas installé, `engine.use()` rejette avec `CORE:PLUGIN_DEPENDENCY_MISSING` et n'appelle pas `setup()`. `optional` n'est pas vérifié.

### Dépendance entre plugins

Un plugin ne peut pas installer un autre plugin depuis `setup()` : `GwenEngineBase`, le type que reçoit `setup()`, n'a pas de `use()`. Déclarez la dépendance dans `requires` et enregistrez chaque plugin dans `main.ts`, dans l'ordre. GWEN ne les installe pas et ne les réordonne pas. `requires` garantit que les plugins sont installés, mais `current` reste `T | undefined`.

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenPluginRegistry { physics: {}; collision: {} }
}

export const PhysicsSystemPlugin = definePlugin(() => ({
  name: 'physics-system',
  requires: { plugins: ['physics', 'collision'] },
  setup(engine) {
    const physics = optionalService(engine, 'physics')
    const collision = optionalService(engine, 'collision')
  },
}))
```

Puis dans `main.ts` :

```ts
import { setupGwen } from '@gwenjs/core'
import { PhysicsPlugin } from './plugins/physics'
import { CollisionPlugin } from './plugins/collision'
import { PhysicsSystemPlugin } from './plugins/physics-system'

const engine = await setupGwen()
await engine.use(PhysicsPlugin())
await engine.use(CollisionPlugin())
await engine.use(PhysicsSystemPlugin())
await engine.start()
```

## En pratique

### Exemple de composition de plugin complexe

Voici un exemple réaliste : un jeu basé sur la physique qui utilise l'entrée, l'audio, la simulation physique et l'interface utilisateur.

**Plugin d'entrée :**

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (k: string) => boolean }
  }
}

const keys = new Set<string>()

export const InputPlugin = definePlugin({ provides: ['input'] }, () => ({
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

declare module '@gwenjs/schema' {
  interface GwenProvides { physics2d: { addBody(id: string, mass: number): void } }
}

export const Physics2DPlugin = definePlugin(
  { provides: ['physics2d'], options: { defaults: { gravity: { x: 0, y: 9.81 } } } },
  (opts) => ({
    name: 'physics2d',
    setup(engine) {
      const gravity = opts.gravity.y
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
  }),
)
```

**Plugin de jeu** (compose Input et Physics) :

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenPluginRegistry { input: {}; physics2d: {} }
}

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  requires: { plugins: ['input', 'physics2d'] },
  setup(engine) {
    const physics = optionalService(engine, 'physics2d')
    engine.hooks.hook('engine:init', () => {
      // Initialize game state
      physics.current?.addBody('player', 1.0)

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
import { setupGwen } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'
import { Physics2DPlugin } from './plugins/physics'
import { GamePlugin } from './plugins/game'

const engine = await setupGwen()
await engine.use(InputPlugin())
await engine.use(Physics2DPlugin({ gravity: { y: 15 } }))
await engine.use(GamePlugin()) // Rejette avec CORE:PLUGIN_DEPENDENCY_MISSING si l'un des deux manque
await engine.start()
```

### Gestion gracieuse des dépendances manquantes

Utilisez un modèle de détection de fonctionnalité pour les capacités vraiment optionnelles. Les clés `physics2d` et `audio` sont déclarées comme ci-dessus :

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

export const DebugUIPlugin = definePlugin(() => ({
  name: 'debug-ui',
  setup(engine) {
    const physics = optionalService(engine, 'physics2d')
    const audio = optionalService(engine, 'audio')
    engine.hooks.hook('engine:init', () => {
      if (physics.current) {
        // Physics is available — show physics debug overlay
        console.log('[DebugUI] Physics visualization enabled')
      } else {
        console.log('[DebugUI] Physics plugin not found, skipping physics debug')
      }

      if (audio.current) {
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
import { setupGwen } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'
import { AudioPlugin } from './plugins/audio'
import { Physics2DPlugin } from '@gwenjs/physics2d'

const engine = await setupGwen()

// Infrastructure
await engine.use(InputPlugin())
await engine.use(AudioPlugin())

// Simulation
await engine.use(Physics2DPlugin({ gravity: { y: 9.81 } }))

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

declare module '@gwenjs/schema' {
  interface GwenPluginRegistry { input: {}; physics2d: {} }
}

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  requires: { plugins: ['input', 'physics2d'] },
  setup() {},
}))

export default defineGwenModule({
  meta: {
    name: '@my-scope/game-framework',
    configKey: 'gameFramework',
  },
  setup(options, gwen) {
    // Enregistrés dans cet ordre : les dépendances viennent avant le plugin qui les exige
    gwen.addPlugin({ src: "@my-scope/game-framework", export: "InputPlugin" })
    gwen.addPlugin({ src: "@my-scope/game-framework", export: "Physics2DPlugin" })
    gwen.addPlugin({ src: "@my-scope/game-framework", export: "GamePlugin" })
    gwen.addAutoImports([
      { name: 'useInput', from: '@my-scope/game-framework' },
      { name: 'usePhysics2D', from: '@my-scope/game-framework' },
    ])
  },
})
```

## Gestion des erreurs dans les chaînes de plugins

Un plugin qui a besoin d'un autre plugin le nomme dans `requires`. Quand la dépendance n'est pas installée, `engine.use()` rejette avec `GwenPluginDependencyError` (`CORE:PLUGIN_DEPENDENCY_MISSING`) et le `setup()` du plugin ne s'exécute jamais :

```ts
declare module '@gwenjs/schema' {
  interface GwenPluginRegistry { physics2d: {} }
}

export const CriticalGamePlugin = definePlugin(() => ({
  name: 'critical-game',
  requires: { plugins: ['physics2d'] },
  setup(engine) { /* physics2d est installé ici */ },
}))
```

Un plugin dont le `setup()` a levé une erreur n'est pas installé. Un plugin suivant qui l'exige est rejeté avec `CORE:PLUGIN_DEPENDENCY_MISSING`.

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

Utilisez `requires` plutôt que de lever une erreur depuis un hook. `engine.use()` le vérifie avant `setup()` :

```ts
declare module '@gwenjs/schema' {
  interface GwenProvides {
    audio: { play(track: string): void }
  }
  interface GwenPluginRegistry { input: {} }
}

requires: { plugins: ['input'], services: ['logger'], optional: ['audio'] },
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
| `inject(key)` | Récupérez un service enregistré (lève une erreur s'il n'est pas trouvé) |
| `optionalService(engine, key)` | Lecture typée d'un service optionnel : `.current` vaut `undefined` s'il n'est pas trouvé. `tryInject` renvoie `GwenProvides[K] \| undefined` |
| `provide(key, service)` | Enregistrez un service |
| `hooks.hook('engine:init', cb)` | Enregistre un callback exécuté par `engine.start()` une fois tous les plugins installés |
| `hooks.hook('engine:stop', cb)` | Enregistre un callback avant l'arrêt |

### Ordre d'enregistrement des plugins

1. Listez les plugins dans `defineConfig({ plugins: [...] })`
2. Les plugins sont enregistrés dans l'ordre
3. La `setup()` de chaque plugin s'exécute séquentiellement
4. Ce n'est qu'après la configuration de tous les plugins que les systèmes peuvent accéder en toute sécurité aux services

### Meilleur modèle pour les dépendances

```ts
declare module '@gwenjs/schema' {
  interface GwenProvides {
    audio: { play(track: string): void }
  }
  interface GwenPluginRegistry { input: {} }
}

// Plugin avec des dépendances requises et optionnelles
const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  requires: { plugins: ['input'], optional: ['audio'] },
  setup(engine) {
    const audio = optionalService(engine, 'audio')
    engine.hooks.hook('engine:init', () => {
      audio.current?.play('menu-music') // Utilise la fonctionnalité optionnelle
    })
  },
}))
```

Puis dans `main.ts` :

```ts
const engine = await setupGwen()
await engine.use(InputPlugin())
await engine.use(MyPlugin())
await engine.start()
```
