# @gwenjs/schema

> **Internal workspace package — not published to npm.**
> This package is the Single Source of Truth (SSOT) for all GWEN engine configuration types, defaults, and validation logic.

---

## What this package does

`@gwenjs/schema` centralises every concern related to the GWEN engine configuration:

| Responsibility      | What is exported                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Canonical types** | `GwenOptions`, `GwenConfigInput`, `GwenPluginBase`, `GwenModuleEntry`, `GwenHookHandler`, `DeepPartial`, `EngineAPI` |
| **Hook contracts**  | `GwenHooks` and its five constituent interfaces                                                                      |
| **Default values**  | `defaultOptions` — the fully typed baseline config                                                                   |
| **Resolution**      | `resolveConfig()` — merges partial user input with defaults                                                          |
| **Validation**      | `validateResolvedConfig()`, `assertModuleFirstInput()`                                                               |

All other packages in the monorepo (`@gwenjs/app`, `@gwenjs/core`, `@gwenjs/vite`, the CLI) import their config types **only** from `@gwenjs/schema`. No package duplicates these definitions.

---

## How `defineConfig()` uses this package

`defineConfig()` is exported by `@gwenjs/app` (the user-facing helper). It accepts a `GwenUserConfig` object and returns it unchanged — its only purpose is IDE type inference.

Behind the scenes, the CLI and Vite plugin call `resolveConfig()` from `@gwenjs/schema` to turn the user's partial input into a fully normalized `GwenOptions` object:

```
gwen.config.ts           @gwenjs/app            @gwenjs/schema
─────────────────────    ──────────────────    ─────────────────────────────
GwenUserConfig (partial) → defineConfig()  →   resolveConfig(input)
                                           →   validateResolvedConfig(opts)
                                           →   GwenOptions (fully resolved)
```

`resolveConfig()` performs three steps:

1. Deep-merges the user input on top of `defaultOptions` using [`defu`](https://github.com/unjs/defu).
2. Unifies any legacy `tsPlugins` / `wasmPlugins` arrays into the single `plugins` array.
3. Calls `validateResolvedConfig()` and throws a descriptive error on any violation.

---

## Key exported types

### `GwenOptions`

The fully resolved, normalized engine configuration. All fields are non-optional (defaults have been applied).

```typescript
import type { GwenOptions } from '@gwenjs/schema';

const opts: GwenOptions = {
  engine: {
    maxEntities: 5_000, // Integer, 100–1_000_000
    targetFPS: 60, // 30–240
    debug: false,
    enableStats: true,
    sparseTransformSync: true,
    loop: 'internal', // 'internal' | 'external'
    maxDeltaSeconds: 0.1, // > 0, <= 1
  },
  html: {
    title: 'My Game',
    background: '#000000', // Hex colour string
  },
  modules: [],
  plugins: [],
  scenes: [],
  scenesMode: 'auto', // 'auto' | false
  srcDir: 'src',
  outDir: 'dist',
};
```

### `GwenConfigInput`

The user-facing partial config type. Extends `DeepPartial<GwenOptions>` and adds backward-compatible legacy fields.

```typescript
import type { GwenConfigInput } from '@gwenjs/schema';

const input: GwenConfigInput = {
  engine: { maxEntities: 10_000 }, // Only override what you need
  modules: ['@gwenjs/physics2d'],
  // Legacy (deprecated) — migrated automatically by resolveConfig():
  // tsPlugins: [...],
  // wasmPlugins: [...],
};
```

### `GwenPluginBase`

Minimal interface every plugin must satisfy.

```typescript
import type { GwenPluginBase } from '@gwenjs/schema';

const myPlugin: GwenPluginBase = {
  name: 'my-plugin',
  provides: { myService: { doSomething() {} } },
  providesHooks: {
    'my:event': () => {},
  },
};
```

### `GwenModuleEntry`

A module declaration: either a plain string or a `[name, options]` tuple.

```typescript
import type { GwenModuleEntry } from '@gwenjs/schema';

const entries: GwenModuleEntry[] = ['@gwenjs/input', ['@gwenjs/audio', { masterVolume: 0.8 }]];
```

### `DeepPartial<T>`

Utility type that makes every property in `T` recursively optional.

```typescript
import type { DeepPartial, GwenOptions } from '@gwenjs/schema';

type PartialConfig = DeepPartial<GwenOptions>;
// All nested fields become optional — used as the base of GwenConfigInput.
```

### `EngineAPI<Services, Hooks>`

Lightweight engine API contract used by CLI tooling and `gwen prepare`. Not intended for runtime plugin code (use the full `EngineAPI` from `@gwenjs/core` instead).

```typescript
import type { EngineAPI } from '@gwenjs/schema';

type MyServices = { physics: { applyForce(x: number, y: number): void } };
type MyHooks = { 'physics:step': (dt: number) => void };

function toolingHelper(api: EngineAPI<MyServices, MyHooks>) {
  api.services.get('physics').applyForce(0, -9.8);
  api.hooks.hook('physics:step', (dt) => console.log(dt));
}
```

---

## Hook contracts (`GwenHooks` and friends)

`@gwenjs/schema` is the canonical home for all hook name → handler signature mappings.

### `GwenHooks`

The aggregate hook map. Composed from five sub-interfaces via TypeScript `extends`.

```typescript
import type { GwenHooks } from '@gwenjs/schema';

// Default — all type parameters are `unknown` (safe for generic tooling):
type Hooks = GwenHooks;

// Runtime-bound (used by engine-core with concrete entity/plugin types):
type RuntimeHooks = GwenHooks<
  number, // EntityId
  MyPlugin, // Plugin
  MyAPI, // API
  object, // ReloadContext
  PrefabExt,
  SceneExt,
  UIExt
>;
```

### Sub-interfaces

| Interface                 | Hook names                                                                                                                   |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `EngineLifecycleHooks`    | `engine:init`, `engine:start`, `engine:stop`, `engine:tick`, `engine:runtimeError`                                           |
| `PluginLifecycleHooks`    | `plugin:register`, `plugin:init`, `plugin:beforeUpdate`, `plugin:update`, `plugin:render`, `plugin:destroy`                  |
| `EntityLifecycleHooks`    | `entity:create`, `entity:destroy`, `entity:destroyed`                                                                        |
| `ComponentLifecycleHooks` | `component:add`, `component:remove`, `component:removed`, `component:update`                                                 |
| `SceneLifecycleHooks`     | `scene:beforeLoad`, `scene:load`, `scene:loaded`, `scene:beforeUnload`, `scene:unload`, `scene:unloaded`, `scene:willReload` |
| `ExtensionLifecycleHooks` | `prefab:instantiate`, `scene:extensions`, `ui:extensions`                                                                    |

### `RuntimeErrorRecord`

Payload emitted on `engine:runtimeError`. Useful for monitoring pipelines.

```typescript
import type { EngineLifecycleHooks } from '@gwenjs/schema';
// RuntimeErrorRecord is the argument type of 'engine:runtimeError':
// { phase, plugin, message, stack?, timestamp, frame }
```

---

## Runtime exports

### `defaultOptions`

The baseline `GwenOptions` object. Read-only reference — never mutate it directly.

```typescript
import { defaultOptions } from '@gwenjs/schema';

console.log(defaultOptions.engine.maxEntities); // 5000
console.log(defaultOptions.engine.targetFPS); // 60
console.log(defaultOptions.html.background); // '#000000'
console.log(defaultOptions.scenesMode); // 'auto'
```

Full default values:

| Field                        | Default          |
| ---------------------------- | ---------------- |
| `engine.maxEntities`         | `5000`           |
| `engine.targetFPS`           | `60`             |
| `engine.debug`               | `false`          |
| `engine.enableStats`         | `true`           |
| `engine.sparseTransformSync` | `true`           |
| `engine.loop`                | `'internal'`     |
| `engine.maxDeltaSeconds`     | `0.1`            |
| `html.title`                 | `'GWEN Project'` |
| `html.background`            | `'#000000'`      |
| `modules`                    | `[]`             |
| `plugins`                    | `[]`             |
| `scenes`                     | `[]`             |
| `scenesMode`                 | `'auto'`         |
| `srcDir`                     | `'src'`          |
| `outDir`                     | `'dist'`         |

### `resolveConfig(input?)`

Merges partial user input with defaults and validates the result.

```typescript
import { resolveConfig } from '@gwenjs/schema';

const config = resolveConfig({
  engine: { maxEntities: 10_000, debug: true },
  html: { title: 'Space Shooter', background: '#0a0a1a' },
  modules: ['@gwenjs/physics2d', ['@gwenjs/input', { gamepad: true }]],
  mainScene: 'GameScene',
});

// config is a fully typed, validated GwenOptions
console.log(config.engine.targetFPS); // 60  (from defaults)
console.log(config.engine.maxEntities); // 10_000  (from input)
```

### `validateResolvedConfig(config)`

Validates a `GwenOptions` object against the engine's constraint rules. Called automatically by `resolveConfig()` — only use directly when constructing a `GwenOptions` without going through `resolveConfig()`.

```typescript
import { validateResolvedConfig, defaultOptions } from '@gwenjs/schema';

const config = validateResolvedConfig({
  ...defaultOptions,
  engine: { ...defaultOptions.engine, targetFPS: 120 },
});
```

**Validation rules:**

| Field                    | Constraint                                                            |
| ------------------------ | --------------------------------------------------------------------- |
| `engine.maxEntities`     | Integer, 100–1_000_000                                                |
| `engine.targetFPS`       | Number, 30–240                                                        |
| `engine.loop`            | `'internal'` or `'external'`                                          |
| `engine.maxDeltaSeconds` | `> 0` and `<= 1`                                                      |
| `html.background`        | Valid 3- or 6-digit hex colour (`#rgb` or `#rrggbb`)                  |
| `modules`                | Array; each entry is a non-empty string or a `[name, options?]` tuple |
| `plugins`                | Array                                                                 |

### `assertModuleFirstInput(input)`

Guards against legacy plugin-only configs that have no `modules` declared. Called by the CLI before processing a `gwen.config.ts`.

```typescript
import { assertModuleFirstInput } from '@gwenjs/schema';

// Passes — modules are declared:
assertModuleFirstInput({ modules: ['@gwenjs/input'] });

// Throws — legacy plugins without modules:
assertModuleFirstInput({ plugins: [{ name: 'old-plugin' }] });
// → Error: Module-first configuration required: declare at least one entry in `modules`…
```

---

## Complete `gwen.config.ts` example

This is a complete, runnable configuration file using real types from this package:

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app';
import { Canvas2DRenderer } from '@gwenjs/renderer-canvas2d';
import { InputPlugin } from '@gwenjs/input';

export default defineConfig({
  // ── Engine ───────────────────────────────────────────────────────────────
  engine: {
    maxEntities: 2_000, // How many ECS entities to pre-allocate (100–1_000_000)
    targetFPS: 60, // Target simulation rate (30–240)
    debug: false, // Set to true to enable engine debug logging
    enableStats: true, // Collect per-frame performance stats
    loop: 'internal', // Engine drives its own requestAnimationFrame loop
    maxDeltaSeconds: 0.1, // Cap a single tick at 100 ms to avoid spiral-of-death
  },

  // ── HTML dev server ───────────────────────────────────────────────────────
  html: {
    title: 'Space Shooter',
    background: '#0a0a1a', // 3- or 6-digit hex colour
  },

  // ── Framework modules (module-first composition) ──────────────────────────
  modules: [
    '@gwenjs/physics2d', // string shorthand
    ['@gwenjs/audio', { masterVolume: 0.8 }], // [name, options] tuple
  ],

  // ── Plugins (direct instantiation — no module wrapper) ───────────────────
  plugins: [Canvas2DRenderer({ width: 800, height: 600 }), InputPlugin({ gamepad: true })],

  // ── Scene discovery ───────────────────────────────────────────────────────
  scenesMode: 'auto', // Auto-discover scene files under srcDir
  mainScene: 'GameScene', // Load this scene on startup

  // ── Paths ─────────────────────────────────────────────────────────────────
  srcDir: 'src',
  outDir: 'dist',
});
```

> **Note:** `defineConfig()` is an identity function. Its return type is `GwenUserConfig` (from `@gwenjs/app`).
> The engine's Vite plugin and CLI use `resolveConfig()` (from `@gwenjs/schema`) at build time to produce
> the fully validated `GwenOptions` object that the runtime consumes.

---

## Installation

This package is an **internal workspace dependency** and is not published to npm.

To use it within the monorepo:

```jsonc
// packages/your-package/package.json
{
  "dependencies": {
    "@gwenjs/schema": "workspace:*",
  },
}
```

Then import types or runtime helpers:

```typescript
import { resolveConfig, defaultOptions } from '@gwenjs/schema';
import type { GwenOptions, GwenHooks, GwenConfigInput } from '@gwenjs/schema';
```

Do **not** import `@gwenjs/schema` in browser bundles or end-user plugin code — those contexts should use the types re-exported by `@gwenjs/app` and the full API from `@gwenjs/core`.

---

## Development

```bash
# Build (outputs to dist/)
pnpm build

# Watch mode
pnpm watch

# Run tests
pnpm test
```

Tests live in `tests/` and cover defaults, merge logic, all validation rules, and hook type contracts.
