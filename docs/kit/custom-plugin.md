---
title: Writing a Custom Plugin
description: Coming soon.
---

---
title: Writing a Custom Plugin
description: How to create and register a custom GWEN plugin with @gwenjs/kit.
---

# Writing a Custom Plugin

A **plugin** is a TypeScript object conforming to the `GwenPlugin` interface. You create plugins using `definePlugin()` from `@gwenjs/kit`, which returns a factory function you can customize with options.

## The Basics

### Simple Plugin

Here's a basic input handling plugin:

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

    // Expose a service to systems
    engine.provide('input', {
      isKeyDown: (key: string) => keys.has(key),
    })
  },
}))
```

### Plugin with Options

Accept configuration when the plugin is instantiated:

```ts
interface InputOptions {
  repeatDelay?: number
  preventDefault?: string[] // Keys to prevent default on
}

export const InputPlugin = definePlugin<InputOptions>((opts = {}) => {
  const { repeatDelay = 50, preventDefault = [] } = opts
  const keys = new Set<string>()
  const lastRepeat = new Map<string, number>()

  return {
    name: 'input',
    setup(engine) {
      engine.onStart(() => {
        window.addEventListener('keydown', (e) => {
          if (preventDefault.includes(e.key)) e.preventDefault()
          keys.add(e.key)
        })
        window.addEventListener('keyup', (e) => keys.delete(e.key))
      })

      engine.provide('input', {
        isKeyDown: (key: string) => keys.has(key),
        isKeyPressed: (key: string) => {
          if (!keys.has(key)) return false
          const now = Date.now()
          const last = lastRepeat.get(key) ?? now - repeatDelay
          if (now - last >= repeatDelay) {
            lastRepeat.set(key, now)
            return true
          }
          return false
        },
      })
    },
  }
})
```

Register with options in your config:

```ts
import { defineConfig } from '@gwenjs/app'
import { InputPlugin } from './plugins/input'

export default defineConfig({
  plugins: [
    InputPlugin({
      preventDefault: ['ArrowUp', 'ArrowDown'],
    }),
  ],
})
```

## Plugin Lifecycle

Each plugin receives a `setup()` function that runs once when the engine initializes, before any scenes load.

### Available Hooks

```ts
export const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    // Called once during engine init
    // Register services, event listeners, etc.

    engine.onStart(() => {
      // Called after WASM module is loaded
      // Safe to use engine features here
    })

    engine.onDestroy(() => {
      // Called before engine shutdown
      // Cleanup listeners, free resources
    })
  },

  teardown() {
    // Alternative cleanup method
    // Called at same time as onDestroy()
  },
}))
```

## Providing Services

Use `engine.provide()` to register a service that systems can access:

```ts
engine.provide('myService', {
  getData() { /* ... */ },
  setData(val) { /* ... */ },
})
```

Access the service in a system using `useEngine().get()`:

```ts
import { defineSystem, useEngine } from '@gwenjs/core'

export const MySystem = defineSystem(() => {
  const { get } = useEngine()
  const myService = get('myService')

  return (ctx) => {
    const data = myService.getData()
  }
})
```

## Error Handling

Handle errors that occur in your plugin:

```ts
export const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) { /* ... */ },

  onError(error, context) {
    if (context.phase === 'onRender') {
      // Render errors are non-fatal — suppress them
      context.recover()
    } else {
      // Other errors are fatal — let them propagate
      console.error(`[my-plugin] ${error.message}`)
    }
  },
}))
```

The `context` object provides:
- `phase` — Which lifecycle phase errored (e.g., `'onRender'`, `'onUpdate'`)
- `recover()` — Suppress the error and continue (only for non-fatal phases)

## In Practice

### Audio Plugin Example

Here's a realistic audio plugin using a library like Howler.js:

```ts
import { definePlugin, defineGwenModule } from '@gwenjs/kit'
import { Howl } from 'howler'

interface AudioOptions {
  volume?: number
}

class AudioManager {
  private sounds = new Map<string, Howl>()

  constructor(private volume: number = 0.8) {}

  load(name: string, src: string) {
    const sound = new Howl({ src, volume: this.volume })
    this.sounds.set(name, sound)
  }

  play(name: string) {
    this.sounds.get(name)?.play()
  }

  stop(name: string) {
    this.sounds.get(name)?.stop()
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol))
    this.sounds.forEach((sound) => sound.volume(this.volume))
  }

  dispose() {
    this.sounds.forEach((sound) => sound.unload())
    this.sounds.clear()
  }
}

export const AudioPlugin = definePlugin<AudioOptions>((opts = {}) => ({
  name: 'audio',
  setup(engine) {
    const manager = new AudioManager(opts.volume)
    engine.provide('audio', manager)

    engine.onDestroy(() => {
      manager.dispose()
    })
  },
}))

// Module to package the plugin
export default defineGwenModule({
  meta: { name: '@gwenjs/audio', configKey: 'audio' },
  defaults: { volume: 0.8 },
  setup(options, gwen) {
    gwen.addPlugin(AudioPlugin(options))
    gwen.addAutoImports([
      { name: 'useAudio', from: '@gwenjs/audio' },
    ])
  },
})
```

Use in a system:

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const SoundEffectSystem = defineSystem(() => {
  const { get } = useEngine()
  const audio = get('audio')

  audio.load('jump', '/sounds/jump.mp3')
  audio.load('coin', '/sounds/coin.mp3')

  return (ctx) => {
    // Play sounds based on game events
  }
})
```

## API Summary

### definePlugin

Factory function to create a plugin:

```ts
const MyPlugin = definePlugin<Options>((opts?: Options) => ({
  name: string
  setup(engine: GwenEngine): void
  teardown?(): void
  onError?(error: Error, context: ErrorContext): void
}))
```

### GwenEngine

The engine API available in `setup()`:

| Method | Purpose |
|--------|---------|
| `provide(key, service)` | Register a service for systems to access |
| `onStart(callback)` | Hook called after WASM loads |
| `onDestroy(callback)` | Hook called before shutdown |
| `use(plugin)` | Register another plugin (for composing plugins) |

### Error Context

```ts
interface ErrorContext {
  phase: 'setup' \| 'onStart' \| 'onRender' \| 'onUpdate' \| 'onDestroy'
  recover(): void
}
```
