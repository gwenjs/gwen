---
title: Composing Plugins
description: Coming soon.
---

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

### Optional Dependencies

Check if another service exists before using it:

```ts
import { definePlugin } from '@gwenjs/kit'

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  setup(engine) {
    engine.onStart(() => {
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

### Plugin Dependency in setup()

Some plugins might register other plugins during their setup:

```ts
import { definePlugin } from '@gwenjs/kit'
import { PhysicsPlugin } from './physics'
import { CollisionPlugin } from './collision'

export const PhysicsSystemPlugin = definePlugin(() => ({
  name: 'physics-system',
  setup(engine) {
    // Register dependent plugins within setup
    engine.use(PhysicsPlugin())
    engine.use(CollisionPlugin())

    engine.onStart(() => {
      // Now you can safely use physics and collision services
      const physics = engine.get('physics')
      const collision = engine.get('collision')
    })
  },
}))
```

Then in `main.ts`:

```ts
import { createEngine } from '@gwenjs/core'
import { PhysicsSystemPlugin } from './plugins/physics-system'

const engine = await createEngine()
await engine.use(PhysicsSystemPlugin())
await engine.start()
```

## In Practice

### Complex Plugin Composition Example

Here's a realistic example: a physics-based game that uses input, audio, physics simulation, and UI.

**Input Plugin:**

```ts
import { definePlugin } from '@gwenjs/kit'

const keys = new Set<string>()

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  setup(engine) {
    engine.onStart(() => {
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
import { definePlugin } from '@gwenjs/kit'

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

**Game Plugin** (composes Input and Physics):

```ts
import { definePlugin } from '@gwenjs/kit'
import { InputPlugin } from './input'
import { Physics2DPlugin } from './physics'

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  setup(engine) {
    // Register required dependencies
    engine.use(InputPlugin())
    engine.use(Physics2DPlugin({ gravity: 15 }))

    engine.onStart(() => {
      const input = engine.get('input')
      const physics = engine.get('physics2d')

      // Initialize game state
      physics.addBody('player', 1.0)

      engine.onDestroy(() => {
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
import { createEngine } from '@gwenjs/core'
import { GamePlugin } from './plugins/game'

const engine = await createEngine()
await engine.use(GamePlugin()) // Internally registers Input and Physics
await engine.start()
```

### Handling Missing Dependencies Gracefully

Use a feature-detection pattern for truly optional capabilities:

```ts
import { definePlugin } from '@gwenjs/kit'

export const DebugUIPlugin = definePlugin(() => ({
  name: 'debug-ui',
  setup(engine) {
    engine.onStart(() => {
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

## Plugin Ordering Guidelines

1. **Core infrastructure first** — Input, Audio, Platform-specific plugins
2. **Simulation next** — Physics, Animation, AI
3. **Game logic last** — Game-specific plugins that use the above
4. **UI and Debug last** — Debug, UI plugins that query multiple services

Example in `main.ts`:

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

## Using Modules for Complex Plugins

For complex plugin compositions, use `defineGwenModule()` to package everything:

```ts
import { defineGwenModule, definePlugin } from '@gwenjs/kit'
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
      { name: 'useInput', from '@my-scope/game-framework' },
      { name: 'usePhysics2D', from '@my-scope/game-framework' },
    ])
  },
})
```

## Error Handling in Plugin Chains

If a plugin fails to initialize, downstream plugins won't have access to its service:

```ts
export const CriticalGamePlugin = definePlugin(() => ({
  name: 'critical-game',
  setup(engine) {
    engine.onStart(() => {
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

```ts
engine.onStart(() => {
  const requiredService = engine.get('required')
  if (!requiredService) {
    throw new Error('Required service not found')
  }
})
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
| `use(plugin)` | Register a plugin during another plugin's setup |
| `get(key)` | Retrieve a registered service (returns `undefined` if not found) |
| `provide(key, service)` | Register a service |
| `onStart(cb)` | Hook called after WASM loads |
| `onDestroy(cb)` | Hook called before shutdown |

### Plugin Registration Order

1. List plugins in `defineConfig({ plugins: [...] })`
2. Plugins are registered in order
3. Each plugin's `setup()` runs sequentially
4. Only after all plugins are set up can systems safely access services

### Best Pattern for Dependencies

```ts
// Define plugin with required and optional dependencies
const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    engine.onStart(() => {
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

Then in `main.ts`:

```ts
const engine = await createEngine()
await engine.use(RequiredPlugin())
await engine.use(MyPlugin())
await engine.start()
```
