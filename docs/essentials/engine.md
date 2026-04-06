---
title: The Engine
description: Creating and configuring the GWEN engine instance, and how it manages the game loop.
---

# The Engine

The **GWEN engine** is the runtime that boots your game, loads WASM, manages the scene graph, and runs your systems each frame. This guide shows you how to create an engine, configure it, and access it from within your systems.

## The Basics

### Creating an Engine

First, define your configuration, then create the engine:

```ts
import { createEngine } from '@gwenjs/core'
import { defineConfig } from '@gwenjs/app'
import { Physics2DPlugin } from '@gwenjs/physics2d'

import MainScene from './scenes/main'
import MenuScene from './scenes/menu'

const config = defineConfig({
  plugins: [Physics2DPlugin()],
  scenes: {
    main: MainScene,
    menu: MenuScene,
  },
  initialScene: 'main',
})

const engine = createEngine(config)
await engine.start()
```

### Configuration Options

| Option | Type | Description |
|---|---|---|
| `plugins` | `Plugin[]` | Plugins to load (e.g., physics, rendering, networking) |
| `scenes` | `Record<string, SceneClass>` | Map of scene name to class |
| `initialScene` | `string` | Name of the scene to load on startup |
| `wasm` | `WasmModule` | (optional) Custom WASM module (defaults to bundled gwen_core.wasm) |
| `logger` | `Logger` | (optional) Custom logger instance |
| `debug` | `boolean` | (optional) Enable debug mode (logs, gizmos, etc.) |

### Engine Lifecycle

When you call `engine.start()`, this happens in order:

1. **Boot** — Load WASM module, initialize internal systems
2. **Plugin Mount** — Call `mount()` on each plugin
3. **Scene Load** — Load the initial scene, spawn its actors
4. **Actor Setup** — Call `onStart()` on each actor in the scene
5. **System Setup** — Call `onStart()` callbacks in each system
6. **Game Loop** — Each frame:
   - Call `onUpdate(dt)` on each system
   - Render
   - Physics simulation (if Physics2D plugin is loaded)
7. **Scene Unload** — When switching scenes, call `onDestroy()` on actors and systems
8. **Plugin Unmount** — Call `unmount()` on each plugin

## Accessing the Engine in Systems

Inside a system's setup function, use the `useEngine()` hook to access the engine instance:

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyDown('ArrowLeft')) {
      // Handle input
    }
  })
})
```

From the engine, you can:

- Access the **current scene** — `engine.currentScene`
- **Spawn/destroy entities** — `engine.spawn()`, `engine.destroy()`
- Access **plugins** — `engine.getPlugin(PhysicsPlugin)`
- **Switch scenes** — `engine.loadScene('menu')`
- Access **input state** — `engine.input`

## Accessing Engine in Components and Actors

Inside an **actor** (scene node), you can access the engine via the actor's context:

```ts
import { Actor } from '@gwenjs/core'

export class Player extends Actor {
  onStart() {
    const engine = this.scene.engine
    this.scene.spawn(/* ... */)
  }
}
```

## Handling Startup and Shutdown

Use plugin `mount()` and `unmount()` for initialization and cleanup:

```ts
import { Plugin } from '@gwenjs/core'

export class MyPlugin extends Plugin {
  mount(engine) {
    console.log('Game is starting!')
    // Initialize external libraries, load assets, etc.
  }

  unmount(engine) {
    console.log('Game is shutting down!')
    // Clean up: disconnect sockets, stop servers, etc.
  }
}
```

## Common Engine Tasks

### Switching Scenes

```ts
const engine = useEngine()
engine.loadScene('menu')
```

### Getting a Plugin Instance

```ts
import { Physics2DPlugin } from '@gwenjs/physics2d'

const engine = useEngine()
const physics = engine.getPlugin(Physics2DPlugin)
```

### Spawning an Entity

```ts
const engine = useEngine()
const entityId = engine.spawn([
  [Position, { x: 10, y: 20 }],
  [Velocity, { x: 1, y: 0 }],
])
```

## API Summary

| Function/Property | Returns | Description |
|---|---|---|
| `createEngine(config)` | `GwenEngine` | Create engine from config |
| `engine.start()` | `Promise<void>` | Boot engine, load WASM, mount plugins, enter initial scene |
| `engine.loadScene(name)` | `Promise<void>` | Load a new scene |
| `engine.spawn(components)` | `number` | Create a new entity |
| `engine.destroy(id)` | `void` | Delete an entity |
| `engine.currentScene` | `Scene` | The active scene |
| `engine.input` | `InputState` | Current keyboard/mouse state |
| `engine.getPlugin(PluginClass)` | `T` | Retrieve a plugin instance by class |
| `useEngine()` | `GwenEngine` | Access engine from inside a system setup |

## Next Steps

- **[Components](/essentials/components)** — Define data structures for your entities.
- **[Systems](/essentials/systems)** — Write systems to move and update entities.
- **[Scenes and Actors](/essentials/scenes)** — Understand the scene graph and prefab system.
