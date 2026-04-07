---
title: "@gwenjs/math"
description: Pure math helpers for game development — vectors, quaternions, colors, springs, and scalar utilities.
---

# @gwenjs/math

`pnpm add @gwenjs/math`

Pure, allocation-free math utilities for game development. All functions are tree-shakeable — import only what you use.

```ts
import { lerp, clamp, vec3Add, quatSlerp, damp, stepSpring1D } from '@gwenjs/math'
```

---

## Types

### Vec2 / Vec3 / Vec4

```ts
interface Vec2 { x: number; y: number }
interface Vec3 { x: number; y: number; z: number }
interface Vec4 { x: number; y: number; z: number; w: number }
```

### Quat

Unit quaternion representing a 3D rotation. Identity: `{ x: 0, y: 0, z: 0, w: 1 }`.

```ts
interface Quat { x: number; y: number; z: number; w: number }
```

### Color

RGBA color with each channel in `[0, 1]`.

```ts
interface Color { r: number; g: number; b: number; a: number }
```

### Spring types

```ts
interface SpringState1D { value: number; velocity: number }
interface SpringState2D { x: number; y: number; vx: number; vy: number }
interface SpringState3D { x: number; y: number; z: number; vx: number; vy: number; vz: number }

interface SpringOptions {
  stiffness: number  // spring constant k — higher = snappier
  damping: number    // 2 * sqrt(stiffness) = critical (no overshoot)
}
```

---

## Constants

| Constant | Value | Description |
|---|---|---|
| `DEG2RAD` | `Math.PI / 180` | Multiply degrees by this to get radians |
| `RAD2DEG` | `180 / Math.PI` | Multiply radians by this to get degrees |
| `TAU` | `Math.PI * 2` | Full circle in radians |
| `EPSILON` | `1e-6` | Floating-point near-zero threshold |

---

## Scalar

### Interpolation

| Function | Description |
|---|---|
| `lerp(a, b, t)` | Linear interpolation — `t` is **not** clamped |
| `lerpClamped(a, b, t)` | Same but `t` is clamped to `[0, 1]` |
| `inverseLerp(a, b, v)` | Returns the `t` that maps `v` back onto `[a, b]` |
| `remap(v, inMin, inMax, outMin, outMax)` | Map `v` from one range to another |
| `remapClamped(v, inMin, inMax, outMin, outMax)` | Remap with output clamped |
| `smoothstep(edge0, edge1, x)` | Cubic smooth curve — 0 at `edge0`, 1 at `edge1` |
| `smootherstep(edge0, edge1, x)` | Quintic smooth curve (C² continuity) |

```ts
lerp(0, 100, 0.5)              // 50
inverseLerp(0, 100, 25)        // 0.25
remap(0.5, 0, 1, -10, 10)     // 0
smoothstep(0, 1, 0.5)         // 0.5
```

### Clamping

| Function | Description |
|---|---|
| `clamp(v, min, max)` | Clamp `v` to `[min, max]` |
| `clamp01(v)` | Clamp `v` to `[0, 1]` |

### Angle

| Function | Description |
|---|---|
| `degToRad(deg)` | Degrees → radians |
| `radToDeg(rad)` | Radians → degrees |
| `wrapAngle(angle)` | Wrap angle (radians) to `(-π, π]` |
| `moveTowardsAngle(current, target, maxDelta)` | Step angle towards target via shortest arc |

### Motion

| Function | Description |
|---|---|
| `moveTowards(current, target, maxDelta)` | Advance towards target without overshoot |
| `repeat(t, length)` | Non-negative modulo: always returns `[0, length)` |
| `pingPong(t, length)` | Bounce between `0` and `length` |

### Comparison

| Function | Description |
|---|---|
| `approxEqual(a, b, epsilon?)` | `true` if `\|a - b\| ≤ epsilon` (default `1e-6`) |
| `sign(v)` | Returns `-1`, `0`, or `1` |

---

## Damp (exponential smoothing)

Frame-rate-independent smoothing. Prefer `damp` over `lerp` in `onUpdate` — `lerp` is not framerate-independent.

```ts
import { damp, dampVec3Mut } from '@gwenjs/math'

onUpdate((dt) => {
  // dt in GWEN is milliseconds — convert to seconds
  const s = dt / 1000
  cameraX = damp(cameraX, targetX, 8, s)
})
```

| Function | Description |
|---|---|
| `damp(current, target, lambda, dt)` | Scalar exponential decay (`dt` in **seconds**) |
| `dampAngle(current, target, lambda, dt)` | Same but takes the shortest arc |
| `dampVec2(current, target, lambda, dt)` | Returns new Vec2 |
| `dampVec2Mut(current, target, lambda, dt)` | Mutates `current` in-place |
| `dampVec3(current, target, lambda, dt)` | Returns new Vec3 |
| `dampVec3Mut(current, target, lambda, dt)` | Mutates `current` in-place |

`lambda` is the decay rate — higher is faster. A value of `ln(2) / halfLife` gives a precise half-life in seconds. Common values: `4` (slow), `8` (medium), `16` (fast).

---

## Spring (damped harmonic)

Springs produce physically plausible animations that can overshoot, unlike `damp`. Use the **mutating** variants (`stepSpring*`) in game loops to avoid allocations.

```ts
import { makeSpring1D, stepSpring1D, criticalOpts } from '@gwenjs/math'

const opts  = criticalOpts(200) // stiffness=200, no overshoot
const state = makeSpring1D(0)   // starts at 0

onUpdate((dt) => {
  const s = dt / 1000
  stepSpring1D(state, 100, opts, s) // animate towards 100
  transform.setPosition(state.value, 0, 0)
})
```

### Factory functions

| Function | Description |
|---|---|
| `makeSpring1D(initialValue, initialVelocity?)` | Create a `SpringState1D` |
| `makeSpring2D(x?, y?, vx?, vy?)` | Create a `SpringState2D` |
| `makeSpring3D(x?, y?, z?, vx?, vy?, vz?)` | Create a `SpringState3D` |

### Step functions (mutating — use in game loops)

| Function | Description |
|---|---|
| `stepSpring1D(state, target, opts, dt)` | Advance and mutate `state`, returns `state` |
| `stepSpring2D(state, target, opts, dt)` | Same for 2D |
| `stepSpring3D(state, target, opts, dt)` | Same for 3D |

### Functional variants (return new state)

| Function | Description |
|---|---|
| `spring1D(state, target, opts, dt)` | Returns new `SpringState1D` |
| `spring2D(state, target, opts, dt)` | Returns new `SpringState2D` |
| `spring3D(state, target, opts, dt)` | Returns new `SpringState3D` |

### Presets

| Function | Feel | Description |
|---|---|---|
| `criticalOpts(stiffness)` | No overshoot | `damping = 2 * sqrt(stiffness)` |
| `bouncyOpts(stiffness, ratio?)` | Oscillates | `ratio` < 1, default `0.4` |
| `sluggishOpts(stiffness, ratio?)` | Slow return | `ratio` > 1, default `1.5` |

```ts
const snappy  = criticalOpts(400)
const bouncy  = bouncyOpts(200)       // ~40% critical
const sluggish = sluggishOpts(50)     // ~150% critical
```

::: tip dt in seconds
`damp` and `stepSpring*` expect `dt` in **seconds**. GWEN's `onUpdate(dt)` provides `dt` in **milliseconds** — divide by 1000.
:::

---

## Vec2

All functions return new objects unless the name ends in `Mut`.

### Constructors

| Function | Returns |
|---|---|
| `vec2(x, y)` | `{ x, y }` |
| `vec2Zero()` | `{ x: 0, y: 0 }` |
| `vec2One()` | `{ x: 1, y: 1 }` |
| `vec2Right()` | `{ x: 1, y: 0 }` |
| `vec2Up()` | `{ x: 0, y: 1 }` |
| `vec2FromAngle(angle)` | Unit vector at angle θ: `(cos θ, sin θ)` |
| `vec2Clone(v)` | Shallow copy |

### Arithmetic

| Function | Description |
|---|---|
| `vec2Add(a, b)` | `a + b` |
| `vec2AddMut(a, b)` | `a += b`, returns `a` |
| `vec2Sub(a, b)` | `a - b` |
| `vec2SubMut(a, b)` | `a -= b`, returns `a` |
| `vec2Scale(v, s)` | `v * s` |
| `vec2ScaleMut(v, s)` | `v *= s`, returns `v` |
| `vec2Mul(a, b)` | Component-wise `a * b` |
| `vec2Negate(v)` | `-v` |

### Geometry

| Function | Description |
|---|---|
| `vec2Dot(a, b)` | Dot product |
| `vec2Cross(a, b)` | Scalar z-component of `a × b` (positive = CCW) |
| `vec2Length(v)` | Euclidean length |
| `vec2LengthSq(v)` | Squared length (cheaper) |
| `vec2Distance(a, b)` | Distance |
| `vec2DistanceSq(a, b)` | Squared distance (cheaper) |
| `vec2Normalize(v)` | Unit vector (returns zero vector if near-zero) |
| `vec2Perp(v)` | CCW perpendicular `(-y, x)` |
| `vec2Angle(v)` | Angle in radians from +X axis, range `(-π, π]` |
| `vec2AngleBetween(a, b)` | Angle between two vectors, range `[0, π]` |
| `vec2Rotate(v, angle)` | Rotate CCW by `angle` radians |
| `vec2Reflect(v, normal)` | Reflect about unit normal |
| `vec2Lerp(a, b, t)` | Linear interpolation |
| `vec2ClampLength(v, maxLength)` | Clamp to max length |

### Comparison

| Function | Description |
|---|---|
| `vec2Equals(a, b, epsilon?)` | Component-wise near-equality |
| `vec2IsZero(v)` | `true` if both components are exactly `0` |

---

## Vec3

All functions return new objects unless the name ends in `Mut`.

### Constructors

| Function | Returns |
|---|---|
| `vec3(x, y, z)` | `{ x, y, z }` |
| `vec3Zero()` | `{ x: 0, y: 0, z: 0 }` |
| `vec3One()` | `{ x: 1, y: 1, z: 1 }` |
| `vec3Right()` | `{ x: 1, y: 0, z: 0 }` |
| `vec3Up()` | `{ x: 0, y: 1, z: 0 }` |
| `vec3Forward()` | `{ x: 0, y: 0, z: -1 }` (right-handed) |
| `vec3Clone(v)` | Shallow copy |

### Arithmetic

| Function | Description |
|---|---|
| `vec3Add(a, b)` | `a + b` |
| `vec3AddMut(a, b)` | `a += b`, returns `a` |
| `vec3Sub(a, b)` | `a - b` |
| `vec3SubMut(a, b)` | `a -= b`, returns `a` |
| `vec3Scale(v, s)` | `v * s` |
| `vec3ScaleMut(v, s)` | `v *= s`, returns `v` |
| `vec3Mul(a, b)` | Component-wise `a * b` |
| `vec3Negate(v)` | `-v` |

### Geometry

| Function | Description |
|---|---|
| `vec3Dot(a, b)` | Dot product |
| `vec3Cross(a, b)` | Cross product — vector perpendicular to both |
| `vec3Length(v)` | Euclidean length |
| `vec3LengthSq(v)` | Squared length (cheaper) |
| `vec3Distance(a, b)` | Distance |
| `vec3DistanceSq(a, b)` | Squared distance (cheaper) |
| `vec3Normalize(v)` | Unit vector (returns zero vector if near-zero) |
| `vec3AngleBetween(a, b)` | Angle in radians `[0, π]` |
| `vec3Reflect(v, normal)` | Reflect about unit normal |
| `vec3Project(v, onto)` | Project `v` onto unit vector |
| `vec3Reject(v, onto)` | Component of `v` perpendicular to `onto` |
| `vec3Lerp(a, b, t)` | Linear interpolation |
| `vec3ClampLength(v, maxLength)` | Clamp to max length |

### Comparison

| Function | Description |
|---|---|
| `vec3Equals(a, b, epsilon?)` | Component-wise near-equality |
| `vec3IsZero(v)` | `true` if all components are exactly `0` |

---

## Quaternion

Unit quaternions represent 3D rotations. Convention: `(x, y, z, w)` with identity `(0, 0, 0, 1)`.

### Constructors

| Function | Description |
|---|---|
| `quatIdentity()` | Identity rotation `(0, 0, 0, 1)` |
| `quatClone(q)` | Shallow copy |
| `quatFromAxisAngle(axis, angle)` | From unit axis + angle in radians |
| `quatFromEuler(x, y, z)` | From Euler angles (radians) — **YXZ** order (yaw/pitch/roll) |
| `quatFromTo(from, to)` | Shortest rotation between two unit vectors |
| `quatLookAt(forward, up?)` | Rotation pointing `forward`, default up `(0, 1, 0)` |

### Operations

| Function | Description |
|---|---|
| `quatMultiply(a, b)` | Combine rotations — applies `b` then `a` |
| `quatDot(a, b)` | Dot product (used for interpolation) |
| `quatConjugate(q)` | Conjugate — inverse for unit quaternions |
| `quatInverse(q)` | Inverse (works for non-unit quaternions too) |
| `quatNormalize(q)` | Normalize to unit length |
| `quatRotateVec3(q, v)` | Rotate a Vec3 by a unit quaternion |

### Interpolation

| Function | Description |
|---|---|
| `quatNlerp(a, b, t)` | Normalized lerp — cheaper but slightly non-uniform speed |
| `quatSlerp(a, b, t)` | Spherical lerp — constant angular velocity |

### Conversion

| Function | Description |
|---|---|
| `quatToEuler(q)` | Extract Euler angles as `Vec3` (radians, YXZ order) |
| `quatEquals(a, b, epsilon?)` | `true` if both represent the same rotation |

```ts
import { quatFromEuler, quatSlerp, degToRad } from '@gwenjs/math'

const from = quatFromEuler(0, 0, 0)
const to   = quatFromEuler(0, degToRad(90), 0)
const mid  = quatSlerp(from, to, 0.5)  // 45° around Y
```

---

## Color

All channels are in `[0, 1]` (linear space).

### Constructors

| Function | Description |
|---|---|
| `color(r, g, b, a?)` | Create from normalised `[0, 1]` channels (alpha defaults to `1`) |
| `colorWhite()` | `{ r: 1, g: 1, b: 1, a: 1 }` |
| `colorBlack()` | `{ r: 0, g: 0, b: 0, a: 1 }` |
| `colorTransparent()` | `{ r: 0, g: 0, b: 0, a: 0 }` |
| `colorFromHex(hex)` | Parse CSS hex: `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` |
| `colorFromRGB255(r, g, b, a?)` | From `[0, 255]` integer channels |
| `colorFromHSL(h, s, l, a?)` | From hue `[0, 360]`, saturation/lightness `[0, 1]` |
| `colorClone(c)` | Shallow copy |

### Operations

| Function | Description |
|---|---|
| `colorToHex(c)` | Serialize to `#RRGGBBAA` string |
| `colorToHSL(c)` | Returns `{ h, s, l, a }` |
| `colorLerp(a, b, t)` | Linear interpolation between two colors |
| `colorPremultiply(c)` | Premultiply alpha into RGB (for WebGL blending) |
| `colorClamp(c)` | Clamp all channels to `[0, 1]` |

```ts
import { colorFromHex, colorLerp, colorFromHSL } from '@gwenjs/math'

const red    = colorFromHex('#ff0000')
const blue   = colorFromHex('#0000ff')
const purple = colorLerp(red, blue, 0.5)

const sky    = colorFromHSL(200, 0.8, 0.6)  // hue=200, s=80%, l=60%
```

---

## Vec4

Used for homogeneous coordinates and general 4-component data.

### Constructors

| Function | Description |
|---|---|
| `vec4(x, y, z, w)` | Create |
| `vec4Zero()` | `(0, 0, 0, 0)` |
| `vec4One()` | `(1, 1, 1, 1)` |
| `vec4Point(x, y, z)` | `(x, y, z, 1)` — homogeneous point |
| `vec4Dir(x, y, z)` | `(x, y, z, 0)` — homogeneous direction |
| `vec4Clone(v)` | Shallow copy |

### Operations

| Function | Description |
|---|---|
| `vec4Add(a, b)` / `vec4AddMut(a, b)` | Addition |
| `vec4Sub(a, b)` / `vec4SubMut(a, b)` | Subtraction |
| `vec4Scale(v, s)` / `vec4ScaleMut(v, s)` | Scale |
| `vec4Mul(a, b)` | Component-wise multiply |
| `vec4Negate(v)` | Negate |
| `vec4Dot(a, b)` | Dot product |
| `vec4Length(v)` / `vec4LengthSq(v)` | Length / squared length |
| `vec4Normalize(v)` | Unit vector |
| `vec4Lerp(a, b, t)` | Linear interpolation |
| `vec4Equals(a, b, epsilon?)` | Near-equality |
