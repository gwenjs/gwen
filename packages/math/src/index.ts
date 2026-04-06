/**
 * GWEN Math — public API barrel.
 *
 * Import individual sub-modules for best tree-shaking:
 *
 * ```ts
 * import { lerp, clamp }          from '@gwenjs/math';
 * import { damp, dampVec3 }        from '@gwenjs/math';
 * import { spring1D, makeSpring1D } from '@gwenjs/math';
 * import { vec3Add, vec3Normalize } from '@gwenjs/math';
 * import { quatSlerp, quatFromEuler } from '@gwenjs/math';
 * import { colorFromHex, colorLerp } from '@gwenjs/math';
 * ```
 */

// ── Types ─────────────────────────────────────────────────────────────────────
export type {
  Vec2,
  Vec3,
  Vec4,
  Quat,
  Color,
  SpringState1D,
  SpringState2D,
  SpringState3D,
  SpringOptions,
} from './types.js';

// ── Scalar ────────────────────────────────────────────────────────────────────
export {
  DEG2RAD,
  RAD2DEG,
  TAU,
  EPSILON,
  lerp,
  lerpClamped,
  inverseLerp,
  remap,
  remapClamped,
  clamp,
  clamp01,
  smoothstep,
  smootherstep,
  degToRad,
  radToDeg,
  repeat,
  pingPong,
  wrapAngle,
  approxEqual,
  sign,
  moveTowards,
  moveTowardsAngle,
} from './scalar.js';

// ── Damp ──────────────────────────────────────────────────────────────────────
export { damp, dampAngle, dampVec2, dampVec2Mut, dampVec3, dampVec3Mut } from './damp.js';

// ── Spring ────────────────────────────────────────────────────────────────────
export {
  makeSpring1D,
  makeSpring2D,
  makeSpring3D,
  stepSpring1D,
  spring1D,
  stepSpring2D,
  spring2D,
  stepSpring3D,
  spring3D,
  criticalOpts,
  bouncyOpts,
  sluggishOpts,
} from './spring.js';

// ── Vec2 ──────────────────────────────────────────────────────────────────────
export {
  vec2,
  vec2Zero,
  vec2One,
  vec2Right,
  vec2Up,
  vec2FromAngle,
  vec2Add,
  vec2AddMut,
  vec2Sub,
  vec2SubMut,
  vec2Scale,
  vec2ScaleMut,
  vec2Mul,
  vec2Negate,
  vec2Clone,
  vec2Dot,
  vec2Cross,
  vec2LengthSq,
  vec2Length,
  vec2DistanceSq,
  vec2Distance,
  vec2Normalize,
  vec2Perp,
  vec2Angle,
  vec2AngleBetween,
  vec2Rotate,
  vec2Reflect,
  vec2Lerp,
  vec2ClampLength,
  vec2Equals,
  vec2IsZero,
} from './vec2.js';

// ── Vec3 ──────────────────────────────────────────────────────────────────────
export {
  vec3,
  vec3Zero,
  vec3One,
  vec3Right,
  vec3Up,
  vec3Forward,
  vec3Clone,
  vec3Add,
  vec3AddMut,
  vec3Sub,
  vec3SubMut,
  vec3Scale,
  vec3ScaleMut,
  vec3Mul,
  vec3Negate,
  vec3Dot,
  vec3Cross,
  vec3LengthSq,
  vec3Length,
  vec3DistanceSq,
  vec3Distance,
  vec3Normalize,
  vec3AngleBetween,
  vec3Reflect,
  vec3Project,
  vec3Reject,
  vec3Lerp,
  vec3ClampLength,
  vec3Equals,
  vec3IsZero,
} from './vec3.js';

// ── Quaternion ────────────────────────────────────────────────────────────────
export {
  quatIdentity,
  quatClone,
  quatFromAxisAngle,
  quatFromEuler,
  quatFromTo,
  quatLookAt,
  quatMultiply,
  quatDot,
  quatConjugate,
  quatInverse,
  quatNormalize,
  quatRotateVec3,
  quatNlerp,
  quatSlerp,
  quatToEuler,
  quatEquals,
} from './quat.js';

// ── Vec4 ──────────────────────────────────────────────────────────────────────
export {
  vec4,
  vec4Zero,
  vec4One,
  vec4Point,
  vec4Dir,
  vec4Clone,
  vec4Add,
  vec4AddMut,
  vec4Sub,
  vec4SubMut,
  vec4Scale,
  vec4ScaleMut,
  vec4Mul,
  vec4Negate,
  vec4Dot,
  vec4LengthSq,
  vec4Length,
  vec4Normalize,
  vec4Lerp,
  vec4Equals,
} from './vec4.js';

// ── Mat3 ──────────────────────────────────────────────────────────────────────
export type { Mat3 } from './mat3.js';
export {
  mat3,
  mat3Identity,
  mat3Zero,
  mat3Clone,
  mat3Mul,
  mat3MulVec3,
  mat3Transpose,
  mat3Det,
  mat3Inverse,
  mat3Translate,
  mat3Rotate,
  mat3Scale,
  mat3NormalFromMat3,
  mat3Equals,
} from './mat3.js';

// ── Mat4 ──────────────────────────────────────────────────────────────────────
export type { Mat4 } from './mat4.js';
export {
  mat4,
  mat4Identity,
  mat4Zero,
  mat4Clone,
  mat4Mul,
  mat4MulVec4,
  mat4MulPoint,
  mat4MulDir,
  mat4Transpose,
  mat4ToMat3,
  mat4Translate,
  mat4Scale,
  mat4RotateX,
  mat4RotateY,
  mat4RotateZ,
  mat4FromQuat,
  mat4TRS,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Equals,
} from './mat4.js';
export {
  color,
  colorWhite,
  colorBlack,
  colorTransparent,
  colorFromHex,
  colorToHex,
  colorFromRGB255,
  colorFromHSL,
  colorToHSL,
  colorLerp,
  colorPremultiply,
  colorClamp,
  colorClone,
} from './color.js';
