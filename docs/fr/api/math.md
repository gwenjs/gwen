---
title: "@gwenjs/math"
description: "Référence API pour @gwenjs/math."
---

# @gwenjs/math

`pnpm add @gwenjs/math`

Utilitaires mathématiques complets pour le développement de jeux: vecteurs, quaternions, couleurs, ressorts, amortissement et fonctions mathématiques scalaires.

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

## Constantes

| Constante | Valeur | Description |
|---|---|---|
| `DEG2RAD` | `Math.PI / 180` | Multiplicateur degrés vers radians |
| `RAD2DEG` | `180 / Math.PI` | Multiplicateur radians vers degrés |
| `TAU` | `2 * Math.PI` | Deux pi (cercle complet) |
| `EPSILON` | `1e-6` | Petit epsilon pour la comparaison de float |

## Fonctions scalaires

### lerp(a, b, t)

**Signature:**
```ts
function lerp(a: number, b: number, t: number): number
```

**Description.** Interpolation linéaire entre deux valeurs.

**Exemple:**
```ts
const mid = lerp(0, 100, 0.5); // 50
```

### lerpClamped(a, b, t)

**Signature:**
```ts
function lerpClamped(a: number, b: number, t: number): number
```

**Description.** Interpolation linéaire avec t limitée à [0, 1].

### inverseLerp(a, b, value)

**Signature:**
```ts
function inverseLerp(a: number, b: number, value: number): number
```

**Description.** Calcule t tel que lerp(a, b, t) égale value.

### remap(iMin, iMax, oMin, oMax, value)

**Signature:**
```ts
function remap(iMin: number, iMax: number, oMin: number, oMax: number, value: number): number
```

**Description.** Remapie une valeur d'une plage à une autre.

**Exemple:**
```ts
const remapped = remap(0, 100, 0, 1, 50); // 0.5
```

### remapClamped(iMin, iMax, oMin, oMax, value)

**Signature:**
```ts
function remapClamped(iMin: number, iMax: number, oMin: number, oMax: number, value: number): number
```

**Description.** Remapiage avec sortie limitée à [oMin, oMax].

### clamp(value, min, max)

**Signature:**
```ts
function clamp(value: number, min: number, max: number): number
```

**Description.** Limite value entre min et max.

### clamp01(value)

**Signature:**
```ts
function clamp01(value: number): number
```

**Description.** Limite value entre 0 et 1.

### smoothstep(min, max, value)

**Signature:**
```ts
function smoothstep(min: number, max: number, value: number): number
```

**Description.** Interpolation Hermite douce.

### smootherstep(min, max, value)

**Signature:**
```ts
function smootherstep(min: number, max: number, value: number): number
```

**Description.** Interpolation Hermite plus douce (5e ordre).

### degToRad(degrees)

**Signature:**
```ts
function degToRad(degrees: number): number
```

**Description.** Convertit les degrés en radians.

### radToDeg(radians)

**Signature:**
```ts
function radToDeg(radians: number): number
```

**Description.** Convertit les radians en degrés.

### repeat(value, length)

**Signature:**
```ts
function repeat(value: number, length: number): number
```

**Description.** Répète une valeur sur une longueur (comme le modulo pour les floats).

### pingPong(value, length)

**Signature:**
```ts
function pingPong(value: number, length: number): number
```

**Description.** Bascule la valeur d'avant en arrière entre 0 et length.

### wrapAngle(angle)

**Signature:**
```ts
function wrapAngle(angle: number): number
```

**Description.** Enveloppe un angle (en radians) à [-π, π].

### approxEqual(a, b, epsilon?)

**Signature:**
```ts
function approxEqual(a: number, b: number, epsilon?: number): boolean
```

**Description.** Vérifie si deux valeurs sont approximativement égales dans epsilon.

### sign(value)

**Signature:**
```ts
function sign(value: number): number
```

**Description.** Retourne -1, 0, ou 1 pour le signe d'une valeur.

### moveTowards(current, target, maxDelta)

**Signature:**
```ts
function moveTowards(current: number, target: number, maxDelta: number): number
```

**Description.** Déplace current vers target d'au maximum maxDelta.

### moveTowardsAngle(current, target, maxDelta)

**Signature:**
```ts
function moveTowardsAngle(current: number, target: number, maxDelta: number): number
```

**Description.** Déplace l'angle vers target en prenant le chemin le plus court.

## Fonctions d'amortissement

### damp(current, target, smoothing, dt)

**Signature:**
```ts
function damp(current: number, target: number, smoothing: number, dt: number): number
```

**Description.** Amortissement exponentiel vers target.

### dampAngle(current, target, smoothing, dt)

**Signature:**
```ts
function dampAngle(current: number, target: number, smoothing: number, dt: number): number
```

**Description.** Amortissement exponentiel pour les angles (chemin le plus court).

### dampVec2(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec2(current: Vec2, target: Vec2, smoothing: number, dt: number): Vec2
```

**Description.** Amortissement exponentiel pour les vecteurs Vec2.

**Retourne:** Un nouveau Vec2 amorti.

### dampVec2Mut(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec2Mut(current: Vec2, target: Vec2, smoothing: number, dt: number): void
```

**Description.** Amortissement exponentiel pour Vec2 (modifie current).

### dampVec3(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec3(current: Vec3, target: Vec3, smoothing: number, dt: number): Vec3
```

**Description.** Amortissement exponentiel pour les vecteurs Vec3.

**Retourne:** Un nouveau Vec3 amorti.

### dampVec3Mut(current, target, smoothing, dt)

**Signature:**
```ts
function dampVec3Mut(current: Vec3, target: Vec3, smoothing: number, dt: number): void
```

**Description.** Amortissement exponentiel pour Vec3 (modifie current).

## Fonctions de ressort

### makeSpring1D(state, options?)

**Signature:**
```ts
function makeSpring1D(state: SpringState1D, options?: SpringOptions): SpringState1D
```

**Description.** Crée un état de physique de ressort 1D.

### spring1D(state, target, options?, dt)

**Signature:**
```ts
function spring1D(state: SpringState1D, target: number, options?: SpringOptions, dt?: number): void
```

**Description.** Mise à jour d'un ressort 1D vers target.

### makeSpring2D(state, options?)

**Signature:**
```ts
function makeSpring2D(state: SpringState2D, options?: SpringOptions): SpringState2D
```

**Description.** Crée un état de physique de ressort 2D.

### spring2D(state, target, options?, dt)

**Signature:**
```ts
function spring2D(state: SpringState2D, target: Vec2, options?: SpringOptions, dt?: number): void
```

**Description.** Mise à jour d'un ressort 2D vers target.

### makeSpring3D(state, options?)

**Signature:**
```ts
function makeSpring3D(state: SpringState3D, options?: SpringOptions): SpringState3D
```

**Description.** Crée un état de physique de ressort 3D.

### spring3D(state, target, options?, dt)

**Signature:**
```ts
function spring3D(state: SpringState3D, target: Vec3, options?: SpringOptions, dt?: number): void
```

**Description.** Mise à jour d'un ressort 3D vers target.

## Fonctions Vec2

| Fonction | Signature | Description |
|---|---|---|
| `vec2Add` | `(a: Vec2, b: Vec2) => Vec2` | Ajoute deux vecteurs |
| `vec2Sub` | `(a: Vec2, b: Vec2) => Vec2` | Soustrait b de a |
| `vec2Scale` | `(v: Vec2, scalar: number) => Vec2` | Redimensionne le vecteur par scalar |
| `vec2Dot` | `(a: Vec2, b: Vec2) => number` | Produit scalaire |
| `vec2Cross` | `(a: Vec2, b: Vec2) => number` | Produit vectoriel (retourne z) |
| `vec2Length` | `(v: Vec2) => number` | Magnitude du vecteur |
| `vec2LengthSq` | `(v: Vec2) => number` | Magnitude au carré |
| `vec2Normalize` | `(v: Vec2) => Vec2` | Vecteur unitaire |
| `vec2Distance` | `(a: Vec2, b: Vec2) => number` | Distance entre vecteurs |
| `vec2DistanceSq` | `(a: Vec2, b: Vec2) => number` | Distance au carré |
| `vec2Lerp` | `(a: Vec2, b: Vec2, t: number) => Vec2` | Interpolation linéaire |
| `vec2Angle` | `(v: Vec2) => number` | Angle en radians |
| `vec2FromAngle` | `(angle: number, length?: number) => Vec2` | Vecteur depuis l'angle |
| `vec2Rotate` | `(v: Vec2, angle: number) => Vec2` | Rotation par angle |

## Fonctions Vec3

| Fonction | Signature | Description |
|---|---|---|
| `vec3Add` | `(a: Vec3, b: Vec3) => Vec3` | Ajoute deux vecteurs |
| `vec3Sub` | `(a: Vec3, b: Vec3) => Vec3` | Soustrait b de a |
| `vec3Scale` | `(v: Vec3, scalar: number) => Vec3` | Redimensionne le vecteur par scalar |
| `vec3Dot` | `(a: Vec3, b: Vec3) => number` | Produit scalaire |
| `vec3Cross` | `(a: Vec3, b: Vec3) => Vec3` | Produit vectoriel |
| `vec3Length` | `(v: Vec3) => number` | Magnitude du vecteur |
| `vec3LengthSq` | `(v: Vec3) => number` | Magnitude au carré |
| `vec3Normalize` | `(v: Vec3) => Vec3` | Vecteur unitaire |
| `vec3Distance` | `(a: Vec3, b: Vec3) => number` | Distance entre vecteurs |
| `vec3DistanceSq` | `(a: Vec3, b: Vec3) => number` | Distance au carré |
| `vec3Lerp` | `(a: Vec3, b: Vec3, t: number) => Vec3` | Interpolation linéaire |

## Fonctions Quaternion

| Fonction | Signature | Description |
|---|---|---|
| `quatSlerp` | `(a: Quat, b: Quat, t: number) => Quat` | Interpolation linéaire sphérique |
| `quatFromEuler` | `(euler: Vec3) => Quat` | Convertit les angles d'Euler en quaternion |
| `quatToEuler` | `(q: Quat) => Vec3` | Convertit le quaternion en angles d'Euler |
| `quatIdentity` | `() => Quat` | Retourne le quaternion identité |
| `quatMultiply` | `(a: Quat, b: Quat) => Quat` | Multiplie deux quaternions |
| `quatNormalize` | `(q: Quat) => Quat` | Normalise le quaternion |
| `quatInverse` | `(q: Quat) => Quat` | Retourne le quaternion inverse |

## Fonctions Color

| Fonction | Signature | Description |
|---|---|---|
| `colorFromHex` | `(hex: string) => Color` | Parse une couleur hex en RGB |
| `colorToHex` | `(color: Color) => string` | Convertit RGB en chaîne hex |
| `colorLerp` | `(a: Color, b: Color, t: number) => Color` | Interpolation linéaire de couleur |
| `colorHSLToRGB` | `(h: number, s: number, l: number) => Color` | Conversion HSL vers RGB |
| `colorRGBToHSL` | `(color: Color) => [number, number, number]` | Conversion RGB vers HSL |
