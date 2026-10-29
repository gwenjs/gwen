---
title: The Engine
description: Configuring the GWEN engine with gwen.config.ts and accessing it at runtime.
---

# The Engine

The **GWEN engine** is the runtime that boots your game, loads WASM, manages scenes, and runs your systems each frame. Configuration happens in **`gwen.config.ts`** at build time — you never bootstrap the engine manually.

::: info Import required
`useEngine` is not auto-imported. Import it explicitly when you need direct engine access:
```ts
import { useEngine } from '@gwenjs/core'
```
:::

## Build Configuration

Use `defineConfig()` from `@gwenjs/app` to declare modules and engine options:

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    targetFPS: 60,
  },
})
```

This file is processed at build time by the Vite plugin.

`@gwenjs/core` also ships a checked core for each variant, at `@gwenjs/core/wasm/<variant>-dev` (`opt-level=1`, debug assertions and overflow checks on). Nothing loads it yet.

## Config Reference

| Property | Type | Description |
|---|---|---|
| `modules` | `string[]` | Modules to activate (e.g. `['@gwenjs/physics2d']`) |
| `engine.maxEntities` | `number` | Max simultaneous entities (default `10_000`) |
| `engine.targetFPS` | `number` | Target FPS (default `60`) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | WASM variant to load |
| `engine.loop` | `'internal' \| 'external'` | Game loop mode (default `'internal'`) |
| `engine.maxDeltaSeconds` | `number` | Max delta time per frame (default `0.1`) |
| `engine.physicsHz` | `number` | Fixed simulation rate in Hz. `0` = variable dt (default) |
| `engine.maxCatchupSteps` | `number` | Max fixed steps per real frame (default `2`) |
| `engine.debug` | `boolean` | Enable global debug mode |
| `vite` | `object` | Static Vite config extension |
| `hooks` | `Partial<GwenBuildHooks>` | Build-time hook subscriptions |
| `plugins` | `GwenPlugin[]` | Direct plugin registration (escape hatch) |

## Config layering

Later layers win.

| Layer | Source | What it sets |
|---|---|---|
| L0 | Package defaults (`defaults` on the module) | Starting values for that module's section |
| Derived | `engine.variant` | A default under L1, chosen from the modules you list. With `@gwenjs/physics2d` or `@gwenjs/physics3d` listed, a different variant is `APP:CONFIG_CONFLICT`. Otherwise the value in the file wins |
| L1 | The matching section in `gwen.config.ts` | Your values, over L0 |

Vite is a separate stack. The GWEN base comes first, then extenders registered by modules, then your `vite` key last.

| Merge | Rule |
|---|---|
| Plain objects | Deep merge |
| Arrays | The higher layer replaces the array |
| `undefined` | The lower value stays |
| Other values | The higher value is kept, including the same object reference |

| Code | Example |
|---|---|
| `APP:CONFIG_INVALID` | `[GWEN] Invalid gwen.config:` then `"engine" expected an object, received null` |
| `APP:CONFIG_CONFLICT` | The invalid line adds ` (conflicts with @gwenjs/app)` |
| `APP:CONFIG_LOAD_FAILED` | `[GWEN] No gwen.config.ts (or .js / .mjs / .cjs) found in <cwd>.` and `See https://gwenjs.github.io/gwen/api/errors#app-config-load-failed (APP:CONFIG_LOAD_FAILED)` |
| `CORE:INVALID_CONFIG` | `Invalid config "maxEntities": -1.` |

Sources: `packages/app/src/app.ts:459`, `packages/app/src/config.ts:79-91`, `packages/app/src/config.ts:93-99`, `packages/vite/src/index.ts:482-504`, `packages/app/src/app.ts:200-202`, `packages/app/src/app.ts:257`, `packages/app/src/merge.ts:21-22`, `packages/app/src/config-error.ts:14-22`, `packages/app/tests/config-layering.test.ts:128-130`, `packages/app/tests/config-layering.test.ts:133-138`, `packages/app/tests/config-layering.test.ts:541-549`, `packages/app/tests/config-layering.test.ts:154-157`, `packages/app/src/config-loader.ts:110`, `packages/app/tests/config-loader.test.ts:123-126`, `packages/core/src/engine/config-error.ts:30`, `packages/core/tests/engine/config-validator.test.ts:33`.

## Extending Vite

GWEN manages your Vite configuration — no `vite.config.ts` needed. Use the `vite` field for static config:

```ts
export default defineConfig({
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
  },
})
```

For programmatic or conditional config, use the build hook:

```ts
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = { '~assets': './src/assets' }
    },
  },
})
```

## Accessing the Engine at Runtime

Inside a system or actor factory, call `useEngine()` to get the raw engine instance. This is rarely needed — composables like `useQuery`, `useService`, and `useHook` cover most use cases.

```ts
import { useEngine } from '@gwenjs/core'

export const DebugSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    const stats = engine.getStats()
    console.log(`FPS: ${stats.fps}, frame: ${stats.frameCount}`)
  })
})
```

## Engines on one instance

This is `wasmInstance: "shared"`, the default (`packages/core/src/engine/wasm-bridge.ts:358`). Two engines can run on one WASM instance. Each engine owns its entities, its physics world, and its path buffers. A path written by one engine is not the path the other engine reads.

`jsUrl` is the URL of `gwen_core_factory.js`. `init()` with `jsUrl` or `wasmUrl` on an already initialised bridge rejects `CORE:WASM_LOAD_ERROR`.

They still share three things:

- The linear-memory budget. One instance has one `WebAssembly.Memory`. Every engine of that instance allocates from it. `wasmMemoryBytes` is the size of that memory.
- The allocator. One allocator serves every engine of the instance.
- The fault domain. A trap leaves the shared instance's memory in an unknown state. Only the engine that trapped is marked poisoned. The other engines are not stopped and must not be trusted.

## Several engines per page or process

`wasmInstance` selects the WASM instance (`packages/core/src/engine/wasm-bridge.ts:358`).

| Mode | Behaviour |
| --- | --- |
| `shared` (default) | One instance per compiled module. Engines of that module share its linear memory. |
| `isolated` | One instance per engine, with its own linear memory (`packages/core/src/engine/wasm-instance-provider.ts:128`). |

`createEngine` in Node still defaults to `shared` (`packages/core/src/engine/engine-factory.ts:79`). `isolated` becomes the Node default only with `@gwenjs/core/node`, in a later ticket (#267).

Browser `isolated` is not supported until the browser gate (#265).

Measured capacity:

| Runtime | What was measured |
| --- | --- |
| Chromium | About 125 WASM memories per renderer process. |
| Firefox | About 999, then throws a value that is not an `Error`. |
| WebKit | No stable limit. Observations of 13,575 to 14,600 instances. Those figures are observations, not limits. |
| Node 22 | About 10 GiB of virtual memory per instance with the trap handler on. Budget with `ulimit -v`. |

When `glue.initSync` throws a `RangeError` or a value that is not an `Error`, `initWasm` throws `CORE:WASM_CAPACITY_EXHAUSTED` (`packages/core/src/engine/wasm-instance-provider.ts:46`). The fallbacks are `wasmInstance: "shared"`, fewer engines per process, or worker threads.

```ts
const room = await createEngine({ variant: "physics2d", wasmInstance: "isolated" });
```

## Frame Stats

`engine.getStats()` returns live performance metrics:

| Field | Type | Description |
|---|---|---|
| `fps` | `number` | Smoothed frames per second from the raw frame duration |
| `rawFrameTime` | `number` | Uncapped, unscaled frame duration in seconds |
| `frameCount` | `number` | Completed frames. In fixed mode, one per simulation step |
| `deltaTime` | `number` | Last step in seconds, after the cap and `timeScale` |
| `entityCount` | `number` | Alive entities at the time of the call |
| `budgetMs` | `number` | Frame budget in ms (`1000 / targetFPS`) |
| `wasmMemoryBytes` | `number` | WASM linear memory in bytes. Omitted when the bridge has no memory |
| `phaseMs` | `object` | Per-phase timings in ms. Present only when `__GWEN_DEV__` and `debug` are both true |
| `overBudget` | `boolean` | Present only with `phaseMs`. `true` when `phaseMs.total` exceeds `budgetMs` |

`deltaTime` is in seconds. A fresh engine reports `frameCount` `0`. One `advance(1 / 60)` reports that step as `deltaTime`.

```ts run
import assert from "node:assert/strict";

const before = engine.getStats().frameCount;
await engine.advance(1 / 60);
const stepped = engine.getStats().deltaTime;
const after = engine.getStats().frameCount;
assert.equal(before, 0);
assert.equal(stepped, 1 / 60);
assert.equal(after, 1);
```

For external loop mode (`engine.loop: 'external'`), advance frames manually with `engine.advance(delta)`:

```ts
engine.advance(delta)  // tick one frame with the given delta (seconds)
```

## Loop Modes

GWEN supports three loop configurations, set via `engine.loop` and `engine.physicsHz` in `gwen.config.ts`.

### Internal loop (default)

The framework calls `requestAnimationFrame` internally. `onUpdate` receives a variable `dt` each frame. `engine.start()` throws `GwenError` `CORE:WASM_NOT_INITIALIZED` when the WASM bridge is not active, and it does not schedule a frame. `start()`, `startExternal()`, and `advance()` throw `GwenEngineStateError` (`CORE:INVALID_STATE_TRANSITION`) on an illegal lifecycle call. `use()` and `unuse()` are allowed in `idle` and `running` only. They reject with `GwenEngineStateError` in `starting`, `stopping`, `stopped`, and `faulted`. A stopped engine is final: it cannot take new plugins. A fatal error moves the engine to `faulted` and does not call `stop()`. Only the first `stop()` runs teardown. `stop()` is not re-entrant-blocking: a `stop()` called while teardown runs returns immediately. To know when teardown has finished, watch `engine:state-change` to `stopped`. `stop()` then runs, in this order: the `engine:stop` hook, each plugin `teardown` in reverse install order, clearing hooks, clearing isolation, clearing this engine's WASM modules, disposing disposables, disposing the owned WASM bridge, disposing the error policy, then the state `stopped`. When you pass `_bridge`, call `bridge.dispose()` after `stop()`. `stop()` disposes the WASM bridge it owns. After an owned bridge is disposed, every bridge call that reaches WASM throws `CORE:ENGINE_DISPOSED`; `isActive()` returns false. Plugin `teardown` must be idempotent with work already done on `engine:stop`. Services provided through the `engine` argument of `setup()` are removed before its `teardown`. A `provide` on a captured engine, or `useEngine().provide(...)` inside `setup`, is not removed. A `faulted` engine stays `faulted`.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'internal', targetFPS: 60 },
})
```

### External loop

Set `loop: 'external'` when you control the frame loop yourself — for example inside a custom renderer, a test harness, or a server-side simulation.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'external' },
})
```

The framework calls `engine.startExternal()` instead of `engine.start()`. Drive frames manually:

```ts
// your loop
function tick(dt: number) {
  engine.advance(dt) // seconds
  requestAnimationFrame(() => tick(getDelta()))
}
```

### Fixed timestep

Set `physicsHz` to a non-zero value to enable a fixed-step accumulator loop. `onUpdate` always receives `1 / physicsHz` as `dt`, regardless of actual frame pacing.

```ts
export default defineConfig({
  engine: {
    physicsHz: 60,      // 60 fixed steps per second
    maxCatchupSteps: 2, // at most 2 steps per real frame
  },
})
```

The accumulator pattern:
1. Each display frame, elapsed time accumulates. `advance(dt)` adds `dt` to the same accumulator.
2. For each `1 / physicsHz` seconds accumulated, one simulation step fires, up to `maxCatchupSteps`.
3. Whole steps still left after that cap are dropped.
4. One `engine:render(alpha)` runs after those steps, including when no step ran. `alpha` is the leftover fraction of a step, in `[0, 1)`, and ignores `timeScale`.

### Interpolation

With `physicsHz > 0`, each fixed step stores a 2D history sample after `update_transforms` and before `engine:update`. `engine.frame` is the same object for the life of the engine.

`engine.frame.alpha` is the value passed to the latest `engine:render`. It is `1` when `physicsHz` is `0`, and the leftover fraction of a step otherwise. `engine.frame.rendering` is true only while those handlers run. `engine.frame.transforms2D` is the history pair, or `null` when `physicsHz` is `0`, before the first fixed seed, and after `stop()`.

A renderer reads one slot from `engine:render`. Hoist `out`. The helper writes into it and allocates nothing.

```ts
import { readInterpolatedTransform2D } from '@gwenjs/core'

const out = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

engine.hooks.hook('engine:render', (alpha) => {
  const pair = engine.frame.transforms2D
  if (pair === null) return
  if (!readInterpolatedTransform2D(pair, slot, alpha, out)) return
  draw(out.x, out.y, out.rotation)
})
```

The helper returns false, and leaves `out` untouched, when `slot` is outside the pair or the current sample has no transform. A teleport flag, or a previous sample with no transform, copies the current sample.

`useTransform().world` uses that sample for `x`, `y`, and `rotation` during render when the pair is present and the current slot has a transform. `worldRaw` always reads the raw world cache. `scaleX` and `scaleY` stay `1` on both, and `z` stays `0`. `teleport(x, y)` sets the local position and marks the next history commit, so the following renders snap instead of blending.

The sample stored on a step does not include the `engine:update` writes of that same step. Those writes are published on the next step. A render at `alpha` 0 copies the previous sample. That is the one-step lag.

`createEntity()` allocates a wasm entity. `destroyEntity` calls `delete_entity`, emits `entity:destroy`, and does not remove the transform node. The record stays. The next commit skips that dead record after clearing the buffer, so the slot is zeros and `readInterpolatedTransform2D` returns false. A renderer must drop the entity on `entity:destroy`. Issue #220 removes the node.

`physicsHz === 0` does not allocate the history buffers. `alpha` stays `1`, `transforms2D` stays `null`, and `world` matches `worldRaw`.

A surface renderer `renderViews` callback still receives `1`. This page does not change that call.

`engine.timeScale` scales the step `dt` only. A `timeScale` of `0.5` halves simulation speed and leaves `alpha` unchanged. There is no `pause()` and no `paused` state. `timeScale` of `0` makes the step `dt` `0`. The state does not change.

A never-started engine is already `idle`. After `startExternal()`, the state is `running`. Neither step changes it.

```ts run
import assert from "node:assert/strict";

assert.equal(engine.state, "idle");
engine.timeScale = 0;
await engine.advance(1 / 60);
const frozen = engine.getStats().deltaTime;
assert.equal(frozen, 0);
assert.equal(engine.state, "idle");
```

```ts run
import assert from "node:assert/strict";

await engine.startExternal();
engine.timeScale = 0;
await engine.advance(1 / 60);
const scaled = engine.getStats().deltaTime;
assert.equal(scaled, 0);
const startedState = engine.state;
assert.equal(startedState, "running");
```

::: info Determinism
With `physicsHz > 0`, every simulation step runs with the same `dt`. Two runs reach the same world state when every fixed step receives the same inputs in the same order, starting from the same configuration, on the same GWEN version, WASM variant and browser or runtime. To control steps exactly, drive the loop yourself with `engine.advance(1 / physicsHz)`. GWEN 1.0 makes no determinism guarantee across browsers, operating systems or CPUs, and none for the variable-dt loop (`physicsHz: 0`). Reading `performance.now()`, `Date.now()` or `Math.random()` inside a system breaks reproducibility. GWEN 1.0 has no built-in world snapshot or save/restore.
:::

::: info Multiplayer (1.0)
Networked play is not part of GWEN 1.0. Transport, prediction, and interest management stay future plugins. In Node, the only supported loop is `startExternal()` followed by `advance(dt)`. `start()` and its `setTimeout` fallback are not a supported server loop.

These are 1.0 targets. A line marked Target is not true on this tree.

1. Target (#89): the engine starts in Node with no DOM globals, from bytes or a compiled module, for the light, 2D, and 3D variants.
2. `startExternal()` plus one `advance(1 / physicsHz)` runs one fixed step and one render. `engine:afterTick` runs once per step, and `frameCount` counts those steps. `advance(dt)` accumulates on the same clock as `start()`.
3. With `physicsHz === 0`, `advance(dt)` runs one step. Its `dt` is the caller value, capped by `maxDeltaSeconds` and scaled by `timeScale`, and it does not come from the wall clock. With `physicsHz > 0`, the capped caller value is added to the accumulator and each step uses `1 / physicsHz` scaled by `timeScale`.
4. Target (#59): several engines in one process share no runtime state, and `stop()` on one engine leaves the others running. The bridge does not store a glue module on `globalThis`.
5. A fatal error moves only that engine to `faulted`.
6. Global error handlers are optional. Core installs none unless `window` exists.
7. Determinism is not guaranteed. The Determinism note on this page says so (#84).
8. Running out of entity capacity throws `GwenWasmError` with code `CORE:ENTITY_LIMIT_REACHED`. The bridge stays usable. The WASM module does not trap.

1.0 does not provide lockstep, rollback, a world snapshot, tick-indexed input, or an `advance(dt, inputs)` overload. Two peers on different platforms may diverge.
:::

## API Summary

| | |
|---|---|
| `defineConfig(options)` | Build-time framework configuration |
| `useEngine()` | Access raw engine (any engine context) |
| `engine.getStats()` | Live performance metrics |
| `engine.advance(delta)` | Manual frame tick (external loop mode only) |

## Next Steps

- **[Components](/essentials/components)** — Define the data structures your game will use.
- **[Systems](/essentials/systems)** — Write systems to move and update entities.
- **[Scenes](/essentials/scenes)** — Organize your game into distinct states.
- **[Actors](/essentials/actors)** — Create composable, instance-based game objects.
