---
title: Composing Plugins
description: Combine multiple plugins with dependencies and optional capabilities.
---

# Composing Plugins

Real games often need multiple plugins that work together. This guide shows how to compose plugins that depend on each other, handle optional dependencies, and manage initialization order.

## The Basics

### Plugin Ordering

Plugins are registered in `main.ts` with `engine.use()`. **Dependencies must be registered before plugins that depend on them.**

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

### Optional Dependencies

Name what must be installed in `requires`, and read optional services with `optionalService` or `tryInject`. On the engine `setup()` receives, both are typed through `GwenProvides`, which the plugin that provides the service augments. `tryInject` returns `GwenProvides[K] | undefined`:

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides { audio: { play(track: string): void } }
}

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  // Input is required: engine.use() rejects without it
  requires: { plugins: ['input'], optional: ['audio'] },
  setup(engine) {
    const audio = optionalService(engine, 'audio')
    engine.hooks.hook('engine:init', () => {
      // Audio is optional: `current` is undefined when it is absent
      audio.current?.play('game-music')
    })
  },
}))
```

If `input` is not installed, `engine.use()` rejects with `CORE:PLUGIN_DEPENDENCY_MISSING` and does not call `setup()`. `optional` is not checked.

### Plugin Dependency

A plugin cannot install another plugin from `setup()`: `GwenEngineBase`, the type `setup()` receives, has no `use()`. Declare the dependency in `requires` and register every plugin in `main.ts`, in order. GWEN does not install or reorder them. `requires` guarantees the plugins are installed, but `current` is still `T | undefined`.

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

export const PhysicsSystemPlugin = definePlugin(() => ({
  name: 'physics-system',
  requires: { plugins: ['physics', 'collision'] },
  setup(engine) {
    const physics = optionalService(engine, 'physics')
    const collision = optionalService(engine, 'collision')
  },
}))
```

Then in `main.ts`:

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

## In Practice

### Complex Plugin Composition Example

Here's a realistic example: a physics-based game that uses input, audio, physics simulation, and UI.

**Input Plugin:**

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (k: string) => boolean }
  }
}

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

**Physics Plugin:**

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides { physics2d: { addBody(id: string, mass: number): void } }
}

export const Physics2DPlugin = definePlugin((opts: { gravity?: number } = {}) => ({
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

**Game Plugin** (composes Input and Physics):

```ts
import { definePlugin, optionalService } from '@gwenjs/kit/plugin'

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

**Configuration in `gwen.config.ts`:**

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/game-framework'],
})
```

**Registration in `main.ts`:**

```ts
import { setupGwen } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'
import { Physics2DPlugin } from './plugins/physics'
import { GamePlugin } from './plugins/game'

const engine = await setupGwen()
await engine.use(InputPlugin())
await engine.use(Physics2DPlugin({ gravity: 15 }))
await engine.use(GamePlugin()) // Rejects with CORE:PLUGIN_DEPENDENCY_MISSING if either is absent
await engine.start()
```

### Handling Missing Dependencies Gracefully

Use a feature-detection pattern for truly optional capabilities. The keys `physics2d` and `audio` are declared as above:

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

## Plugin Ordering Guidelines

1. **Core infrastructure first** — Input, Audio, Platform-specific plugins
2. **Simulation next** — Physics, Animation, AI
3. **Game logic last** — Game-specific plugins that use the above
4. **UI and Debug last** — Debug, UI plugins that query multiple services

Example in `main.ts`:

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
await engine.use(Physics2DPlugin({ gravity: 9.81 }))

// Game
await engine.use(GamePlugin())

// Debug (optional)
if (isDevelopment) {
  await engine.use(DebugPlugin({ showPhysics: true }))
}

await engine.start()
```

## Using Modules for Complex Plugins

For complex plugin compositions, use `defineGwenModule()` to package everything:

```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { definePlugin } from '@gwenjs/kit/plugin'

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
    // Registered in this order: the dependencies come before the plugin that requires them
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

## Error Handling in Plugin Chains

A plugin that needs another plugin names it in `requires`. When the dependency is not installed, `engine.use()` rejects with `GwenPluginDependencyError` (`CORE:PLUGIN_DEPENDENCY_MISSING`) and the plugin's `setup()` never runs:

```ts
export const CriticalGamePlugin = definePlugin(() => ({
  name: 'critical-game',
  requires: { plugins: ['physics2d'] },
  setup(engine) { /* physics2d is installed here */ },
}))
```

A plugin whose `setup()` threw is not installed. A later plugin that requires it is rejected with `CORE:PLUGIN_DEPENDENCY_MISSING`.

## Best Practices

### 1. **Declare Dependencies Clearly**

Document what services a plugin needs:

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

### 2. **Check for Missing Dependencies**

Use `requires` instead of throwing from a hook. `engine.use()` checks it before `setup()`:

```ts
declare module '@gwenjs/schema' {
  interface GwenProvides {
    audio: { play(track: string): void }
  }
}

requires: { plugins: ['input'], services: ['logger'], optional: ['audio'] },
```

### 3. **Use Modules for Complex Compositions**

If you have multiple plugins that always go together, package them in a module.

### 4. **Test Plugin Order**

Always test your plugins in the expected order:

```ts
export default defineConfig({
  plugins: [
    InputPlugin(),
    GamePlugin(), // Requires Input
    DebugPlugin(), // Queries both
  ],
})
```

## API Summary

### GwenEngine Methods for Composition

| Method | Purpose |
|--------|---------|
| `inject(key)` | Retrieve a registered service (throws if not found) |
| `optionalService(engine, key)` | Typed read of an optional service: `.current` is `undefined` if not found. `tryInject` returns `GwenProvides[K] \| undefined` |
| `provide(key, service)` | Register a service |
| `hooks.hook('engine:init', cb)` | Register a callback run by `engine.start()` after every plugin is set up |
| `hooks.hook('engine:stop', cb)` | Register a callback before shutdown |

### Plugin Registration Order

1. List plugins in `defineConfig({ plugins: [...] })`
2. Plugins are registered in order
3. Each plugin's `setup()` runs sequentially
4. Only after all plugins are set up can systems safely access services

### Best Pattern for Dependencies

```ts
declare module '@gwenjs/schema' {
  interface GwenProvides {
    audio: { play(track: string): void }
  }
}

// Define plugin with required and optional dependencies
const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  requires: { plugins: ['input'], optional: ['audio'] },
  setup(engine) {
    const audio = optionalService(engine, 'audio')
    engine.hooks.hook('engine:init', () => {
      audio.current?.play('menu-music') // Use the optional feature
    })
  },
}))
```

Then in `main.ts`:

```ts
const engine = await setupGwen()
await engine.use(InputPlugin())
await engine.use(MyPlugin())
await engine.start()
```
