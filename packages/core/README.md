#@gwenjs/core

**TypeScript SDK for GWEN Game Engine**

Complete framework for building web games with a powerful Rust/WASM core and flexible TypeScript layer.

## 📦 What's Included

- **Engine Class** - Main API for game development
- **Configuration System** - Flexible configuration with builder pattern
- **Type Definitions** - Full TypeScript support
- **Plugin System** - Extensible architecture
- **Event System** - Pub/sub for all events

## 🚀 Quick Start

### Installation

```bash
npm install@gwenjs/core
```

### Basic Usage

```typescript
import { Engine, defineConfig } from '@gwenjs/core';

// Define configuration
const config = defineConfig({
  canvas: 'game-canvas',
  width: 1280,
  height: 720,
  maxEntities: 5000,
});

// Create and start engine
const engine = new Engine(config);

engine.on('ready', () => {
  // Game ready
  const player = engine.createEntity();
  engine.addComponent(player, 'transform', {
    x: 100,
    y: 100,
    rotation: 0,
  });
});

engine.on('update', ({ deltaTime }) => {
  // Update game logic
});

engine.start();
```

## 📚 API Reference

### Engine Class

#### Constructor

```typescript
const engine = new Engine(config?: Partial<EngineConfig>);
```

#### Methods

**Lifecycle:**

- `start()` - Start the game loop
- `stop()` - Stop the game loop

**Entity Management:**

- `createEntity(): number` - Create new entity
- `destroyEntity(id: number): boolean` - Destroy entity
- `entityExists(id: number): boolean` - Check if entity exists
- `getEntityCount(): number` - Get active entity count

**Component Management:**

- `addComponent(entity: number, type: string, data: any)` - Add component to entity
- `removeComponent(entity: number, type: string)` - Remove component
- `getComponent(entity: number, type: string): any` - Get component data
- `hasComponent(entity: number, type: string): boolean` - Check if component exists

**Queries:**

- `query(components: string[]): number[]` - Query entities by components
- `queryWith(components: string[], filter?: Function): number[]` - Query with custom filter

**Events:**

- `on(event: string, listener: Function)` - Register event listener
- `off(event: string, listener: Function)` - Remove event listener

**Plugins:**

- `loadPlugin(name: string, plugin: Plugin)` - Load a plugin
- `getPlugin(name: string): any` - Get loaded plugin
- `hasPlugin(name: string): boolean` - Check if plugin loaded

**Statistics:**

- `getFPS(): number` - Get current FPS
- `getDeltaTime(): number` - Get current frame delta
- `getFrameCount(): number` - Get total frames
- `getStats()` - Get all statistics

### Configuration

#### defineConfig

Simple configuration definition:

```typescript
const config = defineConfig({
  canvas: 'my-canvas',
  width: 1920,
  height: 1080,
  maxEntities: 10000,
  targetFPS: 60,
  debug: true,
});

const engine = new Engine(config);
```

#### ConfigBuilder

Advanced builder with chaining:

```typescript
const config = new ConfigBuilder()
  .setCanvas('game')
  .setResolution(1920, 1080)
  .setMaxEntities(10000)
  .setTargetFPS(60)
  .enableDebug()
  .addPlugin(physicsPlugin)
  .build();

const engine = new Engine(config);
```

## 🎮 Game Examples

### Example 1: Simple Game

```typescript
import { Engine, defineConfig } from '@gwenjs/core';

const engine = new Engine(
  defineConfig({
    canvas: 'canvas',
    width: 800,
    height: 600,
  }),
);

// Create player
const player = engine.createEntity();
engine.addComponent(player, 'transform', {
  x: 400,
  y: 300,
  rotation: 0,
});

engine.addComponent(player, 'sprite', {
  width: 32,
  height: 32,
  color: { r: 0, g: 0, b: 1, a: 1 },
});

// Update loop
engine.on('update', ({ deltaTime }) => {
  const transform = engine.getComponent(player, 'transform');
  transform.x += 100 * deltaTime;
  engine.addComponent(player, 'transform', transform);
});

engine.start();
```

### Example 2: Using Queries

```typescript
// Get all moving entities
const movingEntities = engine.query(['transform', 'velocity']);

engine.on('update', ({ deltaTime }) => {
  movingEntities.forEach((entityId) => {
    const transform = engine.getComponent(entityId, 'transform');
    const velocity = engine.getComponent(entityId, 'velocity');

    transform.x += velocity.x * deltaTime;
    transform.y += velocity.y * deltaTime;

    engine.addComponent(entityId, 'transform', transform);
  });
});
```

### Example 3: With Plugins

```typescript
import { Engine } from '@gwenjs/core';
import { PhysicsPlugin } from '@gwenjs/gwen-physics';
import { InputPlugin } from '@gwenjs/gwen-input';

const engine = new Engine();

// Load plugins
engine.loadPlugin('physics', PhysicsPlugin);
engine.loadPlugin('input', InputPlugin);

const input = engine.getPlugin('input');
const physics = engine.getPlugin('physics');

engine.on('update', () => {
  if (input.isKeyPressed('ArrowUp')) {
    // Handle input
  }
});

engine.start();
```

## 🧩 Plugin System

### Creating a Plugin

```typescript
import type { Plugin } from '@gwenjs/core';

export const MyPlugin: Plugin = {
  name: 'my-plugin',
  version: '1.0.0',

  init(engine) {
    console.log('Plugin initialized');
  },

  update(dt) {
    // Per-frame update
  },

  destroy() {
    console.log('Plugin destroyed');
  },
};

// Use it
engine.loadPlugin('my-plugin', MyPlugin);
```

### Plugin Types

Plugins can be:

- **TypeScript** - Run in main thread
- **Rust/WASM** - Run in WASM thread (fast calculations)

## 📊 Component Types

Built-in components:

### Transform

```typescript
engine.addComponent(entity, 'transform', {
  x: 100,
  y: 100,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
});
```

### Sprite

```typescript
engine.addComponent(entity, 'sprite', {
  width: 64,
  height: 64,
  color: { r: 1, g: 0, b: 0, a: 1 },
  opacity: 1,
  imageUrl: 'path/to/image.png',
});
```

### Velocity

```typescript
engine.addComponent(entity, 'velocity', {
  x: 100,
  y: 50,
});
```

## 🎯 Global Engine Access

Get the global engine instance:

```typescript
import { getEngine, useEngine } from '@gwenjs/core';

// Get or create
const engine = getEngine();

// Or use hook (must be initialized first)
const engine = useEngine();
```

## 📖 Events

Listen to engine events:

```typescript
// Engine lifecycle
engine.on('start', () => console.log('Game started'));
engine.on('stop', () => console.log('Game stopped'));

// Frame updates
engine.on('update', ({ deltaTime, frameCount }) => {
  console.log(`Frame ${frameCount}, DT: ${deltaTime}`);
});

engine.on('render', () => {
  // Render event
});

// Entity events
engine.on('entityCreated', (entityId) => {
  console.log(`Entity ${entityId} created`);
});

engine.on('componentAdded', ({ entityId, componentType }) => {
  console.log(`Component ${componentType} added to entity ${entityId}`);
});
```

## 🔧 Configuration Reference

```typescript
interface EngineConfig {
  // Maximum entities in scene
  maxEntities: number;

  // Canvas element ID or reference
  canvas: string | HTMLCanvasElement;

  // Canvas dimensions
  width: number;
  height: number;

  // Target FPS
  targetFPS: number;

  // Enable debug mode
  debug?: boolean;

  // Show statistics
  enableStats?: boolean;

  // Plugins to load
  plugins?: Plugin[];
}
```

## 🚀 Performance Tips

1. **Use Queries** - Pre-calculate queries for repeated operations
2. **Batch Updates** - Update multiple entities in one loop
3. **Use WASM Plugins** - Offload heavy calculations to Rust
4. **Limit Entities** - Use appropriate `maxEntities` value
5. **Profile** - Check FPS counter to identify bottlenecks

## 📝 TypeScript Support

Full TypeScript support with complete type definitions:

```typescript
import type { EngineConfig, Entity, Component, Plugin } from '@gwenjs/core';
```

## 🐛 Debug Mode

Enable debug logging:

```typescript
const engine = new Engine({
  debug: true,
  enableStats: true,
});

// Get stats
const stats = engine.getStats();
console.log(stats.fps, stats.entityCount);
```

## 📚 Next Steps

- **[API Docs](./docs/API.md)** - Complete API reference
- **[Plugin Guide](./docs/PLUGINS.md)** - How to create plugins
- **[Examples](./examples/)** - Full game examples
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues

## 📄 License

MIT
