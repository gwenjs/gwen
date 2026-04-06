---
title: "@gwenjs/math"
description: "API reference for @gwenjs/math."
---

# @gwenjs/math

`pnpm add @gwenjs/math`

Comprehensive math utilities for game development: vectors, quaternions, colors, springs, damping, and scalar math functions.

## Types

### Vec2

**Signature:**
```ts
interface Vec2 {
  x: number;
  y: number;
}
```

### Vec3

**Signature:**
```ts
interface Vec3 {
  x: number;
  y: number;
  z: number;
}
```

### Vec4

**Signature:**
```ts
interface Vec4 {
  x: number;
  y: number;
  z: number;
  w: number;
}
```

### Quat

**Signature:**
```ts
interface Quat {
  x: number;
  y: number;
  z: number;
  w: number;
}
```

### Color

**Signature:**
```ts
interface Color {
  r: number;
  g: number;
  b: number;
  a?: number;
}
```

### SpringState1D

**Signature:**
```ts
interface SpringState1D {
  value: number;
  velocity: number;
}
```

### SpringState2D

**Signature:**
```ts
interface SpringState2D {
  value: Vec2;
  velocity: Vec2;
}
```

### SpringState3D

**Signature:**
```ts
interface SpringState3D {
  value: Vec3;
  velocity: Vec3;
}
```

### SpringOptions

**Signature:**
```ts
interface SpringOptions {
  frequency?: number;
  damping?: number;
}
```

## Constants

| Constant | Value | Description |
|---|---|---|
| `DEG2RAD` | `Math.PI / 180` | Degrees to radians multiplier |
| `RAD2DEG` | `180 / Math.PI` | Radians to degrees multiplier |
| `TAU` | `2 * Math.PI` | Two pi (full circle) |
| `EPSILON` | `1e-6` | Small epsilon for float comparison |

## Scalar Functions

### lerp(a, b, t)

**Signature:**
```ts
function lerp(a: number, b: number, t: number): number
```

**Description.** Linear interpolation between two values.

**Example:**
```ts
const mid = lerp(0, 100, 0.5); // 50
```

### lerpClamped(a, b, t)

**Signature:**
```ts
function lerpClamped(a: number, b: number, t: number): number
```

**Description.** Linear interpolation with t clamped to [0, 1].

### inverseLerp(a, b, value)

**Signature:**
```ts
function inverseLerp(a: number, b: number, value: number): number
```

**Description.** Calculates t such that lerp(a, b, t) equals value.

### remap(iMin, iMax, oMin, oMax, value)

**Signature:**
```ts
function remap(iMin: number, iMax: number, oMin: number, oMax: number, value: number): number
```

**Description.** Remaps a value from one range to another.

**Example:**
```ts
const remapped = remap(0, 100, 0, 1, 50); // 0.5
```

### remapClamped(iMin, iMax, oMin, oMax, value)

**Signature:**
```ts
function remapClamped(iMin: number, iMax: number, oMin: number, oMax: number, value: number): number
```

**Description.** Remap with output clamped to [oMin, oMax].

### clamp(value, min, max)

**Signature:**
```ts
function clamp(value: number, min: number, max: number): number
```

**Description.** Clamps value between min and max.

### clamp01(value)

**Signature:**
```ts
function clamp01(value: number): number
```

**Description.** Clamps value between 0 and 1.

### smoothstep(min, max, value)

**Signature:**
```ts
function smoothstep(min: number, max: number, value: number): number
```

**Description.** Smooth Hermite interpolation.

### smootherstep(min, max, value)

**Signature:**
```ts
function smootherstep(min: number, max: number, value: number): number
```

**Description.** Smoother Hermite interpolation (5th order).

### degToRad(degrees)

**Signature:**
```ts
function degToRad(degrees: number): number
```

**Description.** Converts degrees to radians.

### radToDeg(radians)

**Signature:**
```ts
function radToDeg(radians: number): number
```

**Description.** Converts radians to degrees.

### repeat(value, length)

**Signature:**
```ts
function repeat(value: number, length: number): number
```

**Description.** Repeats a value over a length (like modulo for floats).

### pingPong(value, length)

**Signature:**
```ts
function pingPong(value: number, length: number): number
```

**Description.** Bounces value back and forth between 0 and length.

### wrapAngle(angle)

**Signature:**
```ts
function wrapAngle(angle: number): number
```

**Description.** Wraps an angle (in radians) to [-π, π].

### approxEqual(a, b, epsilon?)

**Signature:**
```ts
function approxEqual(a: number, b: number, epsilon?: number): boolean
```

**Description.** Checks if two values are approximately equal within epsilon.

### sign(value)

**Signature:**
```ts
function sign(value: number): number
```

**Description.** Returns -1, 0, or 1 for the sign of a value.

### moveTowards(current, target, maxDelta)

**Signature:**
```ts
function moveTowards(current: number, target: number, maxDelta: number): number
```

**Description.** Moves current towards target by at most maxDelta.

### moveTowardsAngle(current, target, maxDelta)

**Signature:**
```ts
function moveTowardsAngle(current: number, target: number, maxDelta: number): number
```

**Description.** Moves angle towards target taking shortest path.

## Damping Functions

### damp(current, target, smoothing, dt)

**Signature:**
```ts
function damp(current: number, target: number, smoothing: number, dt: number): number
```

**Description.** Exponential damping towards target.

### dampAngle(current, target, smoothing, dt)

**Signature:**
```ts
function dampAngle(current: number, target: number, smoothing: number, dt: number): number
```

**Description.** Exponential damping for angles (shortest path).

### dampVec2(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec2(current: Vec2, target: Vec2, smoothing: number, dt: number): Vec2
```

**Description.** Exponential damping for Vec2 vectors.

**Returns:** A new damped Vec2.

### dampVec2Mut(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec2Mut(current: Vec2, target: Vec2, smoothing: number, dt: number): void
```

**Description.** Exponential damping for Vec2 (mutates current).

### dampVec3(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec3(current: Vec3, target: Vec3, smoothing: number, dt: number): Vec3
```

**Description.** Exponential damping for Vec3 vectors.

**Returns:** A new damped Vec3.

### dampVec3Mut(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec3Mut(current: Vec3, target: Vec3, smoothing: number, dt: number): void
```

**Description.** Exponential damping for Vec3 (mutates current).

## Spring Functions

### makeSpring1D(state, options?)

**Signature:**
```ts
function makeSpring1D(state: SpringState1D, options?: SpringOptions): SpringState1D
```

**Description.** Creates a 1D spring physics state.

### spring1D(state, target, options?, dt)

**Signature:**
```ts
function spring1D(state: SpringState1D, target: number, options?: SpringOptions, dt?: number): void
```

**Description.** Updates a 1D spring towards target.

### makeSpring2D(state, options?)

**Signature:**
```ts
function makeSpring2D(state: SpringState2D, options?: SpringOptions): SpringState2D
```

**Description.** Creates a 2D spring physics state.

### spring2D(state, target, options?, dt)

**Signature:**
```ts
function spring2D(state: SpringState2D, target: Vec2, options?: SpringOptions, dt?: number): void
```

**Description.** Updates a 2D spring towards target.

### makeSpring3D(state, options?)

**Signature:**
```ts
function makeSpring3D(state: SpringState3D, options?: SpringOptions): SpringState3D
```

**Description.** Creates a 3D spring physics state.

### spring3D(state, target, options?, dt)

**Signature:**
```ts
function spring3D(state: SpringState3D, target: Vec3, options?: SpringOptions, dt?: number): void
```

**Description.** Updates a 3D spring towards target.

## Vec2 Functions

| Function | Signature | Description |
|---|---|---|
| `vec2Add` | `(a: Vec2, b: Vec2) => Vec2` | Adds two vectors |
| `vec2Sub` | `(a: Vec2, b: Vec2) => Vec2` | Subtracts b from a |
| `vec2Scale` | `(v: Vec2, scalar: number) => Vec2` | Scales vector by scalar |
| `vec2Dot` | `(a: Vec2, b: Vec2) => number` | Dot product |
| `vec2Cross` | `(a: Vec2, b: Vec2) => number` | Cross product (returns z) |
| `vec2Length` | `(v: Vec2) => number` | Magnitude of vector |
| `vec2LengthSq` | `(v: Vec2) => number` | Squared magnitude |
| `vec2Normalize` | `(v: Vec2) => Vec2` | Unit vector |
| `vec2Distance` | `(a: Vec2, b: Vec2) => number` | Distance between vectors |
| `vec2DistanceSq` | `(a: Vec2, b: Vec2) => number` | Squared distance |
| `vec2Lerp` | `(a: Vec2, b: Vec2, t: number) => Vec2` | Linear interpolation |
| `vec2Angle` | `(v: Vec2) => number` | Angle in radians |
| `vec2FromAngle` | `(angle: number, length?: number) => Vec2` | Vector from angle |
| `vec2Rotate` | `(v: Vec2, angle: number) => Vec2` | Rotate by angle |

## Vec3 Functions

| Function | Signature | Description |
|---|---|---|
| `vec3Add` | `(a: Vec3, b: Vec3) => Vec3` | Adds two vectors |
| `vec3Sub` | `(a: Vec3, b: Vec3) => Vec3` | Subtracts b from a |
| `vec3Scale` | `(v: Vec3, scalar: number) => Vec3` | Scales vector by scalar |
| `vec3Dot` | `(a: Vec3, b: Vec3) => number` | Dot product |
| `vec3Cross` | `(a: Vec3, b: Vec3) => Vec3` | Cross product |
| `vec3Length` | `(v: Vec3) => number` | Magnitude of vector |
| `vec3LengthSq` | `(v: Vec3) => number` | Squared magnitude |
| `vec3Normalize` | `(v: Vec3) => Vec3` | Unit vector |
| `vec3Distance` | `(a: Vec3, b: Vec3) => number` | Distance between vectors |
| `vec3DistanceSq` | `(a: Vec3, b: Vec3) => number` | Squared distance |
| `vec3Lerp` | `(a: Vec3, b: Vec3, t: number) => Vec3` | Linear interpolation |

## Quaternion Functions

| Function | Signature | Description |
|---|---|---|
| `quatSlerp` | `(a: Quat, b: Quat, t: number) => Quat` | Spherical linear interpolation |
| `quatFromEuler` | `(euler: Vec3) => Quat` | Converts Euler angles to quaternion |
| `quatToEuler` | `(q: Quat) => Vec3` | Converts quaternion to Euler angles |
| `quatIdentity` | `() => Quat` | Returns identity quaternion |
| `quatMultiply` | `(a: Quat, b: Quat) => Quat` | Multiplies two quaternions |
| `quatNormalize` | `(q: Quat) => Quat` | Normalizes quaternion |
| `quatInverse` | `(q: Quat) => Quat` | Returns inverse quaternion |

## Color Functions

| Function | Signature | Description |
|---|---|---|
| `colorFromHex` | `(hex: string) => Color` | Parses hex color to RGB |
| `colorToHex` | `(color: Color) => string` | Converts RGB to hex string |
| `colorLerp` | `(a: Color, b: Color, t: number) => Color` | Linear color interpolation |
| `colorHSLToRGB` | `(h: number, s: number, l: number) => Color` | HSL to RGB conversion |
| `colorRGBToHSL` | `(color: Color) => [number, number, number]` | RGB to HSL conversion |
