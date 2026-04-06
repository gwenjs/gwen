---
title: Tween & Animation
description: Declarative value interpolation for smooth animations.
---

# Tween & Animation

Tweens are the standard way to animate numeric values, vectors, and colors in GWEN. Instead of manually managing animation state, you declare a start value, end value, and duration—the engine handles interpolation and applies an easing curve.

## The Basics

Create a tween inside a system using `useTween()`:

```ts
import { useTween, defineSystem, onUpdate } from '@gwenjs/core'

export const FadeSystem = defineSystem(() => {
  const opacity = useTween<number>({
    duration: 0.5,
    easing: 'easeInOut',
  })

  onUpdate(() => {
    // opacity.value updates automatically each frame
    mesh.material.opacity = opacity.value

    // Start the tween when a condition is met
    if (shouldFade && !opacity.playing) {
      opacity.play({ from: 1, to: 0 })
    }
  })
})
```

The tween automatically interpolates between `from` and `to` over `duration` seconds. The `easing` function shapes the curve—in this case, `easeInOut` starts slow, speeds up in the middle, then slows again.

### Available Easings

GWEN includes standard easing functions:

| Easing | Curve | Use Case |
|---|---|---|
| `linear` | Constant speed | UI transitions, steady motion |
| `easeIn` | Slow start | Focused emphasis |
| `easeOut` | Slow end | Natural decay |
| `easeInOut` | Slow start and end | Smooth UI animations |
| `easeInBack` | Slight overshoot at start | Bouncy entrances |
| `easeOutBack` | Slight overshoot at end | Bouncy exits |
| `easeInBounce` | Bouncy start | Impact effects |
| `easeOutBounce` | Bouncy end | Landing effects |

You can also provide a custom easing function: `(t: number) => number` where `t` ranges from 0 to 1.

## Sequencing Animations

`defineSequence` chains multiple tweens and timed waits into a single ordered sequence. Useful for intro animations, cutscenes, or any multi-step flow:

```typescript
import { useTween, defineSequence, defineSystem, onStart } from '@gwenjs/core'

export const IntroSystem = defineSystem(() => {
  const fadeIn  = useTween<number>({ duration: 0.4, easing: 'easeOutQuad' })
  const moveUp  = useTween<number>({ duration: 0.6, easing: 'easeInOutCubic' })
  const fadeOut = useTween<number>({ duration: 0.3, easing: 'easeInQuad' })

  const seq = defineSequence([
    { tween: fadeIn,  from: 0,   to: 1   },  // fade in
    { wait: 0.5 },                             // hold for 0.5s
    { tween: moveUp,  from: 0,   to: -80 },  // move up
    { tween: fadeOut, from: 1,   to: 0   },  // fade out
  ])

  onStart(() => {
    seq.play()
    seq.onComplete(() => console.log('intro done'))
  })
})
```

Each step type:
- `{ tween: TweenHandle, from: T, to: T }` — plays the tween and advances when complete
- `{ wait: number }` — pauses for `wait` seconds

### Sequence API

| Method | Description |
|---|---|
| `seq.play()` | Start from step 0 (restarts if already playing) |
| `seq.pause()` | Pause the active step |
| `seq.reset()` | Reset to step 0 without playing |
| `seq.onComplete(cb)` | Register a callback fired when all steps finish |

::: warning
Register `onComplete` on the sequence, not on individual tween handles. Calling `seq.play()` clears `onComplete` callbacks on the tween handles internally.
:::

## Chaining Tweens

Queue multiple segments with `.to()`:

```ts
import { defineSystem, useTween, onUpdate } from '@gwenjs/core'

const AnimationSystem = defineSystem(() => {
  const position = useTween<Vec2>({ duration: 0.2 })

  onUpdate(() => {
    if (shouldStartAnimation && !position.playing) {
      position
        .play({ from: { x: 0, y: 0 }, to: { x: 100, y: 50 } })
        .to({ value: { x: 100, y: 100 }, duration: 0.3 })
        .to({ value: { x: 0, y: 100 }, duration: 0.2 })
    }
  })
})
```

Each call to `.to()` queues a follow-up animation. When the current segment finishes, the next automatically begins.

### Controlling Playback

```ts
const tween = useTween<number>({ duration: 1 })

onUpdate(() => {
  if (someCondition) {
    tween.pause()  // Freeze at current value
  } else {
    tween.play({ from: 0, to: 1 })  // Resume or start
  }

  if (otherCondition) {
    tween.reset()  // Stop and reset to initial state
  }
})
```

### Callbacks

Listen for animation milestones:

```ts
const scale = useTween<number>({ duration: 0.3 })

scale.onComplete(() => {
  console.log('Scale animation finished')
  actor.togglePhase()
})

scale.onLoop(() => {
  console.log('Looped iteration started')
})
```

### Looping and Yoyo

Repeat animations indefinitely or reverse them:

```ts
import { defineSystem, useTween, onUpdate } from '@gwenjs/core'

const BobbingSystem = defineSystem(() => {
  const bobbing = useTween<number>({
    duration: 1,
    loop: true,
    yoyo: true,  // Reverse direction after each cycle
  })

  onUpdate(() => {
    if (!bobbing.playing) {
      bobbing.play({ from: 0, to: 1 })
    }
  })
})
```

With `loop: true` and `yoyo: true`, the tween bounces back and forth: 0 → 1 → 0 → 1, etc.

## In Practice

### Enemy Spawn-In Animation

Enemies scale from 0 to 1 over 0.2 seconds when spawned:

```ts
import { defineSystem, usePrefab, useTween, onUpdate } from '@gwenjs/core'
import { Position, Scale } from './components'
import { EnemyPrefab } from './prefabs'

export const EnemySpawnSystem = defineSystem(() => {
  const scale = useTween<number>({ duration: 0.2, easing: 'easeOut' })
  const enemies = usePrefab(EnemyPrefab)

  onUpdate(() => {
    if (shouldSpawns) {
      const id = enemies.spawn({ x: 100, y: 100 })
      Scale.x[id] = 0
      Scale.y[id] = 0
      
      if (!scale.playing) {
        scale.play({ from: 0, to: 1 })
      }
      
      // Update scale each frame
      Scale.x[id] = scale.value
      Scale.y[id] = scale.value
    }
  })
})
```

### UI Fade-In

Fade a dialog panel in when a scene starts:

```ts
import { defineSystem, useTween, onUpdate } from '@gwenjs/core'

export const DialogSystem = defineSystem(() => {
  const alpha = useTween<number>({ duration: 0.4, easing: 'easeIn' })

  onUpdate(() => {
    if (!alpha.playing) {
      alpha.play({ from: 0, to: 1 })
    }
    
    dialogPanel.opacity = alpha.value
  })
})
```

## Deep Dive

### Tween Pool

The engine manages tweens in a pool to avoid allocation pressure. Each tween occupies a slot, and the slot is reused when the tween completes. If you create tweens dynamically (e.g., one per enemy), the pool ensures no allocations happen during gameplay.

### Performance

Tweens are extremely efficient:
- Each frame, only the current time is advanced.
- Easing functions are lightweight math operations.
- Interpolation happens client-side; no network traffic.

With hundreds of concurrent tweens, performance remains smooth.

### Cancellation

If you need to stop a tween early, call `reset()`. The slot is not released automatically—future work will add lifecycle hooks to handle cleanup.

## API Summary

| Function | Description |
|---|---|
| `useTween<T>(options)` | Create a tween inside a system; returns a `TweenHandle<T>` |
| `tween.play(segment)` | Start animation from `from` to `to` over `duration` |
| `tween.pause()` | Freeze at current value (don't reset) |
| `tween.reset()` | Stop and reset to initial state |
| `tween.to(segment)` | Queue a follow-up animation |
| `tween.onComplete(cb)` | Called when the current segment finishes |
| `tween.onLoop(cb)` | Called each time `loop: true` cycles |
| `tween.value` | Current interpolated value (read-only) |
| `tween.playing` | Whether animation is active (read-only) |

## Next Steps

- **[Physics](/physics/physics2d-composables)** — Animate physics bodies with constraints.
- **[Scenes](/essentials/scenes)** — Learn to coordinate animations across multiple actors.
- **[Debug Mode](/advanced/debug-mode)** — Visualize tween timing in the profiler.
