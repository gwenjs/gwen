# @gwenjs/math

Pure-function math library for the GWEN game engine.
Depends on `@gwenjs/schema` for `GwenError`. Fully tree-shakeable, works in any environment (browser, Node, WASM).

## Installation

```sh
pnpm add @gwenjs/math
```

## Features

| Module         | Types / Functions                                                     |
| -------------- | --------------------------------------------------------------------- |
| **Scalar**     | `lerp`, `clamp`, `smoothstep`, `degToRad`, `moveTowards`, …           |
| **Vec2**       | `vec2`, `vec2Add`, `vec2Normalize`, `vec2Rotate`, `vec2Lerp`, …       |
| **Vec3**       | `vec3`, `vec3Cross`, `vec3Normalize`, `vec3Lerp`, …                   |
| **Vec4**       | `vec4`, `vec4Add`, `vec4Normalize`, `vec4Lerp`, …                     |
| **Mat3**       | `mat3`, `mat3Mul`, `mat3Inverse`, `mat3Translate`, `mat3Rotate`, …    |
| **Mat4**       | `mat4`, `mat4TRS`, `mat4Perspective`, `mat4LookAt`, `mat4FromQuat`, … |
| **Quaternion** | `quatFromEuler`, `quatSlerp`, `quatLookAt`, `quatRotateVec3`, …       |
| **Color**      | `color`, `colorFromHex`, `colorLerp`, `colorFromHSL`, …               |
| **Damp**       | `damp`, `dampVec2`, `dampVec3`                                        |
| **Spring**     | `spring1D`, `spring2D`, `spring3D`, `makeSpring1D`, …                 |

## Usage

### Vectors

```ts
import { vec2, vec2Add, vec2Normalize } from "@gwenjs/math";

const a = vec2(1, 0);
const b = vec2(0, 1);
const sum = vec2Add(a, b); // { x: 1, y: 1 }
const norm = vec2Normalize(sum); // { x: 0.707, y: 0.707 }
```

```ts
import { vec3, vec3Cross, vec3Normalize } from "@gwenjs/math";

const right = vec3(1, 0, 0);
const up = vec3(0, 1, 0);
const fwd = vec3Normalize(vec3Cross(right, up)); // { x: 0, y: 0, z: 1 }
```

```ts
import { vec4, vec4Dot } from "@gwenjs/math";

const a = vec4(1, 2, 3, 1);
const b = vec4(0, 1, 0, 1);
const d = vec4Dot(a, b); // 3
```

### Matrices

```ts
import { mat4TRS, mat4Perspective, mat4LookAt } from "@gwenjs/math";
import { quatFromEuler } from "@gwenjs/math";

// Build a model matrix from position, rotation, scale
const model = mat4TRS({ x: 0, y: 1, z: -5 }, quatFromEuler(0, Math.PI / 4, 0), {
  x: 1,
  y: 1,
  z: 1,
});

// Perspective projection (60° fov, 16:9, near=0.1, far=1000)
const proj = mat4Perspective(Math.PI / 3, 16 / 9, 0.1, 1000);

// Camera view matrix
const view = mat4LookAt(
  { x: 0, y: 5, z: 10 }, // eye
  { x: 0, y: 0, z: 0 }, // target
  { x: 0, y: 1, z: 0 }, // up
);
```

```ts
import { mat3Rotate, mat3MulVec3 } from "@gwenjs/math";

// Rotate a 2D point 45°
const rot = mat3Rotate(Math.PI / 4);
const pt = mat3MulVec3(rot, { x: 1, y: 0, z: 1 }); // homogeneous 2D
```

### Quaternions

```ts
import { quatFromEuler, quatSlerp, quatRotateVec3 } from "@gwenjs/math";

const q1 = quatFromEuler(0, 0, 0);
const q2 = quatFromEuler(0, Math.PI, 0);
const halfway = quatSlerp(q1, q2, 0.5);

const fwd = quatRotateVec3(halfway, { x: 0, y: 0, z: -1 });
```

### Interpolation utilities

```ts
import { lerp, clamp, smoothstep } from "@gwenjs/math";

const t = clamp(rawT, 0, 1);
const v = lerp(0, 100, t);
const st = smoothstep(0, 1, t);
```

```ts
import { damp, dampVec3 } from "@gwenjs/math";

// Smooth damp — frame-rate independent
velocity = damp(velocity, targetVelocity, 0.1, dt);
position = dampVec3(position, targetPosition, 0.05, dt);
```

```ts
import { spring1D, makeSpring1D, criticalOpts } from "@gwenjs/math";

const state = makeSpring1D(0); // initial value
const next = spring1D(state, 1, criticalOpts, dt); // spring toward 1
```

### Colors

```ts
import { colorFromHex, colorLerp, colorToHex } from "@gwenjs/math";

const red = colorFromHex("#ff0000");
const blue = colorFromHex("#0000ff");
const mixed = colorLerp(red, blue, 0.5);
console.log(colorToHex(mixed)); // '#7f007f'
```

## Design

- **Pure functions** — no classes, no mutation unless the function name ends in `Mut`.
- **Plain objects** — `Vec2`, `Vec3`, `Vec4`, `Mat3`, `Mat4`, `Quat`, `Color` are simple `{ x, y }` style interfaces; GC-friendly and serializable.
- **No `this`** — works equally well in systems, WASM bridges, and React components.
- **Tree-shakeable** — import only what you use.

## Public exports

### `.`

Values: `DEG2RAD`, `EPSILON`, `RAD2DEG`, `TAU`, `approxEqual`, `bouncyOpts`, `clamp`, `clamp01`, `color`, `colorBlack`, `colorClamp`, `colorClone`, `colorFromHSL`, `colorFromHex`, `colorFromRGB255`, `colorLerp`, `colorPremultiply`, `colorToHSL`, `colorToHex`, `colorTransparent`, `colorWhite`, `criticalOpts`, `damp`, `dampAngle`, `dampVec2`, `dampVec2Mut`, `dampVec3`, `dampVec3Mut`, `degToRad`, `inverseLerp`, `lerp`, `lerpClamped`, `makeSpring1D`, `makeSpring2D`, `makeSpring3D`, `mat3`, `mat3Clone`, `mat3Det`, `mat3Equals`, `mat3Identity`, `mat3Inverse`, `mat3Mul`, `mat3MulVec3`, `mat3NormalFromMat3`, `mat3Rotate`, `mat3Scale`, `mat3Translate`, `mat3Transpose`, `mat3Zero`, `mat4`, `mat4Clone`, `mat4Equals`, `mat4FromQuat`, `mat4Identity`, `mat4LookAt`, `mat4Mul`, `mat4MulDir`, `mat4MulPoint`, `mat4MulVec4`, `mat4Ortho`, `mat4Perspective`, `mat4RotateX`, `mat4RotateY`, `mat4RotateZ`, `mat4Scale`, `mat4TRS`, `mat4ToMat3`, `mat4Translate`, `mat4Transpose`, `mat4Zero`, `moveTowards`, `moveTowardsAngle`, `pingPong`, `quatClone`, `quatConjugate`, `quatDot`, `quatEquals`, `quatFromAxisAngle`, `quatFromEuler`, `quatFromTo`, `quatIdentity`, `quatInverse`, `quatLookAt`, `quatMultiply`, `quatNlerp`, `quatNormalize`, `quatRotateVec3`, `quatSlerp`, `quatToEuler`, `radToDeg`, `remap`, `remapClamped`, `repeat`, `sign`, `sluggishOpts`, `smootherstep`, `smoothstep`, `spring1D`, `spring2D`, `spring3D`, `stepSpring1D`, `stepSpring2D`, `stepSpring3D`, `vec2`, `vec2Add`, `vec2AddMut`, `vec2Angle`, `vec2AngleBetween`, `vec2ClampLength`, `vec2Clone`, `vec2Cross`, `vec2Distance`, `vec2DistanceSq`, `vec2Dot`, `vec2Equals`, `vec2FromAngle`, `vec2IsZero`, `vec2Length`, `vec2LengthSq`, `vec2Lerp`, `vec2Mul`, `vec2Negate`, `vec2Normalize`, `vec2One`, `vec2Perp`, `vec2Reflect`, `vec2Right`, `vec2Rotate`, `vec2Scale`, `vec2ScaleMut`, `vec2Sub`, `vec2SubMut`, `vec2Up`, `vec2Zero`, `vec3`, `vec3Add`, `vec3AddMut`, `vec3AngleBetween`, `vec3ClampLength`, `vec3Clone`, `vec3Cross`, `vec3Distance`, `vec3DistanceSq`, `vec3Dot`, `vec3Equals`, `vec3Forward`, `vec3IsZero`, `vec3Length`, `vec3LengthSq`, `vec3Lerp`, `vec3Mul`, `vec3Negate`, `vec3Normalize`, `vec3One`, `vec3Project`, `vec3Reflect`, `vec3Reject`, `vec3Right`, `vec3Scale`, `vec3ScaleMut`, `vec3Sub`, `vec3SubMut`, `vec3Up`, `vec3Zero`, `vec4`, `vec4Add`, `vec4AddMut`, `vec4Clone`, `vec4Dir`, `vec4Dot`, `vec4Equals`, `vec4Length`, `vec4LengthSq`, `vec4Lerp`, `vec4Mul`, `vec4Negate`, `vec4Normalize`, `vec4One`, `vec4Point`, `vec4Scale`, `vec4ScaleMut`, `vec4Sub`, `vec4SubMut`, `vec4Zero`, `wrapAngle`

Types: `Color`, `Mat3`, `Mat4`, `Quat`, `SpringOptions`, `SpringState1D`, `SpringState2D`, `SpringState3D`, `Vec2`, `Vec3`, `Vec4`
