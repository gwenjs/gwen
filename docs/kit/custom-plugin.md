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

Register and mount the plugin in your main.ts:

```ts
import { createEngine } from '@gwenjs/core'
import { InputPlugin } from './plugins/input'

const engine = await createEngine({ variant: 'physics2d' })

// Mount the plugin with options
await engine.use(InputPlugin({
  preventDefault: ['ArrowUp', 'ArrowDown'],
}))

await engine.start()
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

## WASM Plugins

Plugins can load a `.wasm` binary and interact with it via typed memory views and ring buffers. Call `engine.loadWasmModule()` inside `setup()`:

```typescript
import { definePlugin } from '@gwenjs/kit'

export const PhysicsPlugin = definePlugin(() => ({
  name: 'PhysicsPlugin',
  async setup(engine) {
    const handle = await engine.loadWasmModule({
      name: 'my-physics',
      url: new URL('./my-physics.wasm', import.meta.url),
      memory: {
        regions: [
          { name: 'agents', byteOffset: 65536, byteLength: 409600, type: 'f32' },
        ],
      },
      channels: [
        { name: 'commands', direction: 'ts→wasm', capacity: 256, itemByteSize: 16 },
      ],
      step: (handle, dt) => {
        handle.exports.step(dt)
      },
      expectedVersion: 1_000_000,
      versionPolicy: 'warn',
    })

    // Memory region view — always live after memory.grow()
    const agents = handle.region('agents')
    agents.f32[0] = 1.0

    // Ring buffer
    const cmd = handle.channel('commands')
    const data = new Float32Array([1, 0, 0, 0])
    cmd.push(data)  // returns false if full
  },
  teardown() {},
}))
```

### WasmModuleOptions

| Field | Type | Description |
|---|---|---|
| `name` | `string` | Unique identifier — use with `useWasmModule('name')` in systems |
| `url` | `URL \| string` | Path to the `.wasm` binary |
| `memory.regions` | `WasmMemoryRegion[]` | Named slices of WASM linear memory |
| `channels` | `WasmChannelOptions[]` | Ring buffers for TS↔WASM message passing |
| `step` | `(handle, dt) => void` | Per-frame callback (optional) |
| `expectedVersion` | `number` | Expected `gwen_plugin_api_version` export value |
| `versionPolicy` | `'warn' \| 'throw' \| 'ignore'` | How to handle version mismatches |

### WasmRegionView

```typescript
const region = handle.region('agents')
region.f32   // Float32Array
region.u8    // Uint8Array
region.i32   // Int32Array
// Views are always backed by current ArrayBuffer after memory.grow()
```

### WasmRingBuffer

```typescript
const buf = handle.channel('commands')
buf.push(data)   // enqueue — returns false if full
buf.pop(dest)    // dequeue into dest — returns false if empty
buf.length       // items in buffer
buf.empty        // true if nothing to pop
buf.full         // true if push would fail
```

### Rust Side

Export a version constant so GWEN can verify API compatibility:

```rust
#[no_mangle]
pub extern "C" fn gwen_plugin_api_version() -> u32 {
    1_000_000 // v1.0.0
}
```
