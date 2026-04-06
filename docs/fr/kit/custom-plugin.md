---
title: Créer un plugin personnalisé
description: Comment créer et enregistrer un plugin GWEN personnalisé avec @gwenjs/kit.
---

# Créer un plugin personnalisé

Un **plugin** est un objet TypeScript conforme à l'interface `GwenPlugin`. Vous créez des plugins en utilisant `definePlugin()` depuis `@gwenjs/kit`, qui retourne une fonction factory que vous pouvez personnaliser avec des options.

## Les bases

### Plugin simple

Voici un plugin de gestion d'entrée basique :

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

### Plugin avec options

Acceptez la configuration lors de l'instanciation du plugin :

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

Enregistrez et montez le plugin dans votre main.ts :

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

## Cycle de vie du plugin

Chaque plugin reçoit une fonction `setup()` qui s'exécute une fois lors de l'initialisation du moteur, avant le chargement de toute scène.

### Hooks disponibles

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

## Fournir des services

Utilisez `engine.provide()` pour enregistrer un service que les systèmes peuvent accéder :

```ts
engine.provide('myService', {
  getData() { /* ... */ },
  setData(val) { /* ... */ },
})
```

Accédez au service dans un système en utilisant `useEngine().get()` :

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

## Gestion des erreurs

Gérez les erreurs qui se produisent dans votre plugin :

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

L'objet `context` fournit :
- `phase` — Quelle phase du cycle de vie a généré l'erreur (par exemple, `'onRender'`, `'onUpdate'`)
- `recover()` — Supprimez l'erreur et continuez (uniquement pour les phases non fatales)

## En pratique

### Exemple de plugin audio

Voici un plugin audio réaliste utilisant une bibliothèque comme Howler.js :

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

Utilisez dans un système :

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

## Résumé de l'API

### definePlugin

Fonction factory pour créer un plugin :

```ts
const MyPlugin = definePlugin<Options>((opts?: Options) => ({
  name: string
  setup(engine: GwenEngine): void
  teardown?(): void
  onError?(error: Error, context: ErrorContext): void
}))
```

### GwenEngine

L'API moteur disponible dans `setup()` :

| Méthode | But |
|---------|-----|
| `provide(key, service)` | Enregistrez un service pour que les systèmes y accèdent |
| `onStart(callback)` | Hook appelé après le chargement de WASM |
| `onDestroy(callback)` | Hook appelé avant l'arrêt |
| `use(plugin)` | Enregistrez un autre plugin (pour composer les plugins) |

### Error Context

```ts
interface ErrorContext {
  phase: 'setup' \| 'onStart' \| 'onRender' \| 'onUpdate' \| 'onDestroy'
  recover(): void
}
```

## Plugins WASM

Les plugins peuvent charger un binaire `.wasm` et interagir avec lui via des vues mémoire typées et des ring buffers. Appelez `engine.loadWasmModule()` dans `setup()` :

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

    // Vue de région mémoire — toujours live après memory.grow()
    const agents = handle.region('agents')
    agents.f32[0] = 1.0

    // Ring buffer
    const cmd = handle.channel('commands')
    const data = new Float32Array([1, 0, 0, 0])
    cmd.push(data)  // retourne false si plein
  },
  teardown() {},
}))
```

### WasmModuleOptions

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Identifiant unique — utilisez avec `useWasmModule('name')` dans les systèmes |
| `url` | `URL \| string` | Chemin vers le binaire `.wasm` |
| `memory.regions` | `WasmMemoryRegion[]` | Tranches nommées de la mémoire linéaire WASM |
| `channels` | `WasmChannelOptions[]` | Ring buffers pour l'échange de messages TS↔WASM |
| `step` | `(handle, dt) => void` | Callback par image (optionnel) |
| `expectedVersion` | `number` | Valeur attendue de l'export `gwen_plugin_api_version` |
| `versionPolicy` | `'warn' \| 'throw' \| 'ignore'` | Comportement en cas d'incompatibilité de version |

### WasmRegionView

```typescript
const region = handle.region('agents')
region.f32   // Float32Array
region.u8    // Uint8Array
region.i32   // Int32Array
// Les vues sont toujours liées au ArrayBuffer courant après memory.grow()
```

### WasmRingBuffer

```typescript
const buf = handle.channel('commands')
buf.push(data)   // enqueue — retourne false si plein
buf.pop(dest)    // dequeue dans dest — retourne false si vide
buf.length       // éléments dans le buffer
buf.empty        // true si rien à dépiler
buf.full         // true si push échouerait
```

### Côté Rust

Exportez une constante de version pour que GWEN puisse vérifier la compatibilité API :

```rust
#[no_mangle]
pub extern "C" fn gwen_plugin_api_version() -> u32 {
    1_000_000 // v1.0.0
}
```
