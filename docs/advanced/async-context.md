---
title: Async Context
description: How GWEN propagates engine context across async lifecycle callbacks, and what to do when it doesn't.
---

# Async Context

GWEN composables — `useEngine()`, `useHTML()`, `usePhysics2D()`, and any service composable from a plugin — rely on an internal engine context being active when they are called. By default this context is **synchronous**: it is set before a callback runs and cleared when it returns.

This means that after an `await` inside an async callback, the context is no longer active:

```ts
const GameScene = defineScene('game', () => {
  onEnter(async () => {
    await loadAssets()
    useHTML().mount('hud')  // ❌ GwenContextError — context lost after await
  })
})
```

GWEN solves this automatically for `onEnter` and `onExit` via a Vite build transform. For other cases, an explicit escape hatch is available.

---

## Automatic fix — `onEnter` and `onExit`

When `@gwenjs/vite` is in your Vite config (via `gwenVitePlugin()`), GWEN instruments every `await` inside `onEnter` and `onExit` callbacks at build time. The engine context is saved before each suspension point and restored after it resolves.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [gwenVitePlugin()],  // ← async context transform included
})
```

With the plugin configured, async `onEnter` and `onExit` work transparently:

```ts
const GameScene = defineScene('game', () => {
  onEnter(async () => {
    await loadAssets()         // ← transform instruments this await
    useHTML().mount('hud')     // ✅ context restored automatically
    usePhysics2D().resume()    // ✅ same
  })

  onExit(async () => {
    await saveProgress()
    useHTML().unmount()        // ✅
  })
})
```

No imports, no wrappers, no configuration beyond `gwenVitePlugin()`.

---

## Actors — the capture pattern

For actors, the recommended approach is to capture composable handles during the **synchronous factory phase**, then use those handles inside async callbacks. This is identical to the Vue `setup()` convention and has zero overhead.

```ts
const PlayerActor = defineActor(PlayerPrefab, () => {
  // ✅ capture during sync factory — engine context is always active here
  const transform = useTransform()
  const html = useHTML()

  onStart(async () => {
    await loadPlayerAssets()
    transform.setPosition(400, 300)  // ✅ closure — no context required
    html.show('player-hud')          // ✅ same
  })

  onDestroy(() => {
    html.hide('player-hud')
  })
})
```

The factory runs once when the plugin is set up, with the engine context active. The handles (`transform`, `html`) capture everything they need at that point — they work as plain closures in any callback, sync or async.

---

## `withAsyncContext` — the escape hatch

If you genuinely need to call a composable **after** an `await` inside `onStart` or a custom async callback, use `withAsyncContext`:

```ts
import { withAsyncContext } from '@gwenjs/core'

const EnemyActor = defineActor(EnemyPrefab, () => {
  onStart(withAsyncContext(async () => {
    await spawnAnimation()
    useHTML().show('enemy-hp-bar')  // ✅ context restored
  }))
})
```

`withAsyncContext` requires:
1. **`@gwenjs/vite` in your Vite config** — the transform instruments the `await` calls
2. **Called from within an active engine context** — must be defined inside a factory (`defineActor`, `defineSystem`, `defineScene`), not at module top-level

::: warning Performance — avoid in high-frequency paths
`withAsyncContext` sets the engine context at each invocation. If used inside `onStart` of an actor that spawns hundreds of times per frame (bullets, particles), prefer the **capture pattern** above — it has no overhead at spawn time.
:::

::: tip Prefer the capture pattern
`withAsyncContext` is an escape hatch, not the default. If the capture pattern works for your use case, use it — it is simpler, faster, and requires no transform knowledge.
:::

---

## Systems — synchronous by design

System hooks (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`) run inside the frame loop and are always synchronous. They have no async variant by design — awaiting inside a frame would stall the engine.

The engine context is always active inside these hooks. No special handling is needed.

```ts
const RenderSystem = defineSystem(() => {
  const html = useHTML()  // ✅ captured in sync setup

  onUpdate((dt) => {
    html.update(dt)  // ✅ closure — always works
  })
})
```

---

## Error guide — `GwenContextError`

When a composable is called outside an active engine context, GWEN throws a `GwenContextError` with a structured `code` property and an actionable message.

```ts
import { GwenContextError } from '@gwenjs/core'

try {
  useEngine()
} catch (e) {
  if (e instanceof GwenContextError) {
    console.log(e.code)     // 'OUTSIDE_ENGINE'
    console.log(e.message)  // explains the fix step by step
  }
}
```

### Diagnosing "context lost after await"

If you see `GwenContextError` thrown from code that is inside an `onEnter` or `onExit`:

1. **Check that `gwenVitePlugin()` is in your `vite.config.ts`** — without the plugin, the transform does not run and contexts are not propagated.
2. **Check that the function is directly passed to `onEnter`/`onExit`** — the transform looks for `onEnter(async () => {...})`. Assigning the function to a variable first defeats the transform.
3. **For `onStart` and custom callbacks**, use `withAsyncContext()` or the capture pattern.

### Diagnosing "called outside engine context"

If the error appears in code that is not inside any lifecycle callback at all:

```ts
// ❌ module top-level — no engine context
const engine = useEngine()
```

Use `engine.run()` to scope the context explicitly:

```ts
const engine = await createEngine(...)
engine.run(() => {
  // ✅ context active here
  const svc = useMyPlugin()
})
```

---

## Quick reference

| Where | Async composable calls work? | How |
|---|---|---|
| `defineSystem()` factory | ✅ Yes (sync) | Engine context active |
| `defineScene()` factory | ✅ Yes (sync) | Engine context active |
| `defineActor()` factory | ✅ Yes (sync) | Engine context active |
| `onUpdate` / `onRender` | ✅ Yes (sync) | Frame loop context |
| `onEnter` / `onExit` | ✅ Yes (async) | Vite transform + `callAsync` |
| `onStart` async after `await` | ⚠️ Opt-in | `withAsyncContext()` or capture pattern |
| Module top-level | ❌ Never | Use `engine.run()` |

---

## Next Steps

- **[Scenes](/essentials/scenes)** — `onEnter` and `onExit` in detail.
- **[Actors](/essentials/actors)** — Actor lifecycle and the capture pattern.
- **[Debug Mode](/advanced/debug-mode)** — Engine-wide debug flags and logging.
