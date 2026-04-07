---
title: "@gwenjs/math"
description: Utilitaires mathématiques purs pour le développement de jeux — vecteurs, quaternions, couleurs, ressorts et scalaires.
---

# @gwenjs/math

`pnpm add @gwenjs/math`

Utilitaires mathématiques purs et sans allocations pour le développement de jeux. Toutes les fonctions sont tree-shakeable — importez uniquement ce dont vous avez besoin.

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

Quaternion unitaire représentant une rotation 3D. Identité : `{ x: 0, y: 0, z: 0, w: 1 }`.

```ts
interface Quat { x: number; y: number; z: number; w: number }
```

### Color

Couleur RGBA avec chaque canal dans `[0, 1]`.

```ts
interface Color { r: number; g: number; b: number; a: number }
```

### Types Spring

```ts
interface SpringState1D { value: number; velocity: number }
interface SpringState2D { x: number; y: number; vx: number; vy: number }
interface SpringState3D { x: number; y: number; z: number; vx: number; vy: number; vz: number }

interface SpringOptions {
  stiffness: number  // constante de raideur k — plus élevée = plus réactif
  damping: number    // 2 * sqrt(stiffness) = critique (sans dépassement)
}
```

---

## Constantes

| Constante | Valeur | Description |
|---|---|---|
| `DEG2RAD` | `Math.PI / 180` | Multipliez les degrés par ce facteur pour obtenir des radians |
| `RAD2DEG` | `180 / Math.PI` | Multipliez les radians par ce facteur pour obtenir des degrés |
| `TAU` | `Math.PI * 2` | Cercle complet en radians |
| `EPSILON` | `1e-6` | Seuil quasi-nul pour les flottants |

---

## Scalaires

### Interpolation

| Fonction | Description |
|---|---|
| `lerp(a, b, t)` | Interpolation linéaire — `t` n'est **pas** limité |
| `lerpClamped(a, b, t)` | Identique mais `t` est limité à `[0, 1]` |
| `inverseLerp(a, b, v)` | Retourne le `t` tel que `lerp(a, b, t) = v` |
| `remap(v, inMin, inMax, outMin, outMax)` | Reporte `v` d'une plage vers une autre |
| `remapClamped(v, inMin, inMax, outMin, outMax)` | Remap avec sortie limitée |
| `smoothstep(edge0, edge1, x)` | Courbe cubique douce — 0 à `edge0`, 1 à `edge1` |
| `smootherstep(edge0, edge1, x)` | Courbe quintique (continuité C²) |

```ts
lerp(0, 100, 0.5)              // 50
inverseLerp(0, 100, 25)        // 0.25
remap(0.5, 0, 1, -10, 10)     // 0
smoothstep(0, 1, 0.5)         // 0.5
```

### Limitation

| Fonction | Description |
|---|---|
| `clamp(v, min, max)` | Limite `v` à `[min, max]` |
| `clamp01(v)` | Limite `v` à `[0, 1]` |

### Angles

| Fonction | Description |
|---|---|
| `degToRad(deg)` | Degrés → radians |
| `radToDeg(rad)` | Radians → degrés |
| `wrapAngle(angle)` | Ramène un angle (radians) dans `(-π, π]` |
| `moveTowardsAngle(current, target, maxDelta)` | Avance l'angle vers la cible par le chemin le plus court |

### Mouvement

| Fonction | Description |
|---|---|
| `moveTowards(current, target, maxDelta)` | Avance vers la cible sans dépassement |
| `repeat(t, length)` | Modulo non-négatif : retourne toujours `[0, length)` |
| `pingPong(t, length)` | Bascule entre `0` et `length` |

### Comparaison

| Fonction | Description |
|---|---|
| `approxEqual(a, b, epsilon?)` | `true` si `\|a - b\| ≤ epsilon` (défaut `1e-6`) |
| `sign(v)` | Retourne `-1`, `0` ou `1` |

---

## Damp (lissage exponentiel)

Lissage indépendant du framerate. Préférez `damp` à `lerp` dans `onUpdate` — `lerp` n'est pas indépendant du framerate.

```ts
import { damp, dampVec3Mut } from '@gwenjs/math'

onUpdate((dt) => {
  // dt dans GWEN est en millisecondes — convertir en secondes
  const s = dt / 1000
  cameraX = damp(cameraX, targetX, 8, s)
})
```

| Fonction | Description |
|---|---|
| `damp(current, target, lambda, dt)` | Décroissance exponentielle scalaire (`dt` en **secondes**) |
| `dampAngle(current, target, lambda, dt)` | Idem mais prend le chemin le plus court |
| `dampVec2(current, target, lambda, dt)` | Retourne un nouveau Vec2 |
| `dampVec2Mut(current, target, lambda, dt)` | Modifie `current` en place |
| `dampVec3(current, target, lambda, dt)` | Retourne un nouveau Vec3 |
| `dampVec3Mut(current, target, lambda, dt)` | Modifie `current` en place |

`lambda` est le taux de décroissance — plus élevé = plus rapide. Valeurs courantes : `4` (lent), `8` (moyen), `16` (rapide).

---

## Spring (ressort harmonique amorti)

Les ressorts produisent des animations physiquement réalistes qui peuvent dépasser la cible, contrairement à `damp`. Utilisez les variantes **mutantes** (`stepSpring*`) dans les boucles de jeu pour éviter les allocations.

```ts
import { makeSpring1D, stepSpring1D, criticalOpts } from '@gwenjs/math'

const opts  = criticalOpts(200) // stiffness=200, sans dépassement
const state = makeSpring1D(0)   // démarre à 0

onUpdate((dt) => {
  const s = dt / 1000
  stepSpring1D(state, 100, opts, s) // anime vers 100
  transform.setPosition(state.value, 0, 0)
})
```

### Fonctions de création

| Fonction | Description |
|---|---|
| `makeSpring1D(initialValue, initialVelocity?)` | Crée un `SpringState1D` |
| `makeSpring2D(x?, y?, vx?, vy?)` | Crée un `SpringState2D` |
| `makeSpring3D(x?, y?, z?, vx?, vy?, vz?)` | Crée un `SpringState3D` |

### Fonctions step (mutantes — à utiliser dans les boucles de jeu)

| Fonction | Description |
|---|---|
| `stepSpring1D(state, target, opts, dt)` | Avance et modifie `state`, retourne `state` |
| `stepSpring2D(state, target, opts, dt)` | Idem pour 2D |
| `stepSpring3D(state, target, opts, dt)` | Idem pour 3D |

### Variantes fonctionnelles (retournent un nouvel état)

| Fonction | Description |
|---|---|
| `spring1D(state, target, opts, dt)` | Retourne un nouveau `SpringState1D` |
| `spring2D(state, target, opts, dt)` | Retourne un nouveau `SpringState2D` |
| `spring3D(state, target, opts, dt)` | Retourne un nouveau `SpringState3D` |

### Préréglages

| Fonction | Comportement | Description |
|---|---|---|
| `criticalOpts(stiffness)` | Pas de dépassement | `damping = 2 * sqrt(stiffness)` |
| `bouncyOpts(stiffness, ratio?)` | Oscillations | `ratio` < 1, défaut `0.4` |
| `sluggishOpts(stiffness, ratio?)` | Retour lent | `ratio` > 1, défaut `1.5` |

```ts
const snappy   = criticalOpts(400)
const bouncy   = bouncyOpts(200)    // ~40% critique
const sluggish = sluggishOpts(50)   // ~150% critique
```

::: tip dt en secondes
`damp` et `stepSpring*` attendent `dt` en **secondes**. Le `onUpdate(dt)` de GWEN fournit `dt` en **millisecondes** — divisez par 1000.
:::

---

## Vec2

Toutes les fonctions retournent de nouveaux objets sauf si le nom se termine par `Mut`.

### Constructeurs

| Fonction | Retourne |
|---|---|
| `vec2(x, y)` | `{ x, y }` |
| `vec2Zero()` | `{ x: 0, y: 0 }` |
| `vec2One()` | `{ x: 1, y: 1 }` |
| `vec2Right()` | `{ x: 1, y: 0 }` |
| `vec2Up()` | `{ x: 0, y: 1 }` |
| `vec2FromAngle(angle)` | Vecteur unitaire à l'angle θ : `(cos θ, sin θ)` |
| `vec2Clone(v)` | Copie superficielle |

### Arithmétique

| Fonction | Description |
|---|---|
| `vec2Add(a, b)` | `a + b` |
| `vec2AddMut(a, b)` | `a += b`, retourne `a` |
| `vec2Sub(a, b)` | `a - b` |
| `vec2SubMut(a, b)` | `a -= b`, retourne `a` |
| `vec2Scale(v, s)` | `v * s` |
| `vec2ScaleMut(v, s)` | `v *= s`, retourne `v` |
| `vec2Mul(a, b)` | Multiplication composante par composante |
| `vec2Negate(v)` | `-v` |

### Géométrie

| Fonction | Description |
|---|---|
| `vec2Dot(a, b)` | Produit scalaire |
| `vec2Cross(a, b)` | Composante z scalaire de `a × b` (positif = sens trigonométrique) |
| `vec2Length(v)` | Longueur euclidienne |
| `vec2LengthSq(v)` | Longueur au carré (moins coûteux) |
| `vec2Distance(a, b)` | Distance |
| `vec2DistanceSq(a, b)` | Distance au carré (moins coûteux) |
| `vec2Normalize(v)` | Vecteur unitaire (retourne zéro si quasi-nul) |
| `vec2Perp(v)` | Perpendiculaire sens trigonométrique `(-y, x)` |
| `vec2Angle(v)` | Angle en radians depuis l'axe +X, plage `(-π, π]` |
| `vec2AngleBetween(a, b)` | Angle entre deux vecteurs, plage `[0, π]` |
| `vec2Rotate(v, angle)` | Rotation sens trigonométrique de `angle` radians |
| `vec2Reflect(v, normal)` | Réflexion par rapport à la normale unitaire |
| `vec2Lerp(a, b, t)` | Interpolation linéaire |
| `vec2ClampLength(v, maxLength)` | Limite à la longueur maximale |

### Comparaison

| Fonction | Description |
|---|---|
| `vec2Equals(a, b, epsilon?)` | Égalité approximative composante par composante |
| `vec2IsZero(v)` | `true` si les deux composantes sont exactement `0` |

---

## Vec3

Toutes les fonctions retournent de nouveaux objets sauf si le nom se termine par `Mut`.

### Constructeurs

| Fonction | Retourne |
|---|---|
| `vec3(x, y, z)` | `{ x, y, z }` |
| `vec3Zero()` | `{ x: 0, y: 0, z: 0 }` |
| `vec3One()` | `{ x: 1, y: 1, z: 1 }` |
| `vec3Right()` | `{ x: 1, y: 0, z: 0 }` |
| `vec3Up()` | `{ x: 0, y: 1, z: 0 }` |
| `vec3Forward()` | `{ x: 0, y: 0, z: -1 }` (repère main droite) |
| `vec3Clone(v)` | Copie superficielle |

### Arithmétique

| Fonction | Description |
|---|---|
| `vec3Add(a, b)` | `a + b` |
| `vec3AddMut(a, b)` | `a += b`, retourne `a` |
| `vec3Sub(a, b)` | `a - b` |
| `vec3SubMut(a, b)` | `a -= b`, retourne `a` |
| `vec3Scale(v, s)` | `v * s` |
| `vec3ScaleMut(v, s)` | `v *= s`, retourne `v` |
| `vec3Mul(a, b)` | Multiplication composante par composante |
| `vec3Negate(v)` | `-v` |

### Géométrie

| Fonction | Description |
|---|---|
| `vec3Dot(a, b)` | Produit scalaire |
| `vec3Cross(a, b)` | Produit vectoriel — perpendiculaire aux deux vecteurs |
| `vec3Length(v)` | Longueur euclidienne |
| `vec3LengthSq(v)` | Longueur au carré (moins coûteux) |
| `vec3Distance(a, b)` | Distance |
| `vec3DistanceSq(a, b)` | Distance au carré (moins coûteux) |
| `vec3Normalize(v)` | Vecteur unitaire (retourne zéro si quasi-nul) |
| `vec3AngleBetween(a, b)` | Angle en radians `[0, π]` |
| `vec3Reflect(v, normal)` | Réflexion par rapport à la normale unitaire |
| `vec3Project(v, onto)` | Projection de `v` sur le vecteur unitaire |
| `vec3Reject(v, onto)` | Composante de `v` perpendiculaire à `onto` |
| `vec3Lerp(a, b, t)` | Interpolation linéaire |
| `vec3ClampLength(v, maxLength)` | Limite à la longueur maximale |

### Comparaison

| Fonction | Description |
|---|---|
| `vec3Equals(a, b, epsilon?)` | Égalité approximative composante par composante |
| `vec3IsZero(v)` | `true` si toutes les composantes sont exactement `0` |

---

## Quaternion

Les quaternions unitaires représentent des rotations 3D. Convention : `(x, y, z, w)` avec l'identité `(0, 0, 0, 1)`.

### Constructeurs

| Fonction | Description |
|---|---|
| `quatIdentity()` | Rotation identité `(0, 0, 0, 1)` |
| `quatClone(q)` | Copie superficielle |
| `quatFromAxisAngle(axis, angle)` | Depuis un axe unitaire + angle en radians |
| `quatFromEuler(x, y, z)` | Depuis les angles d'Euler (radians) — ordre **YXZ** (lacet/tangage/roulis) |
| `quatFromTo(from, to)` | Rotation minimale entre deux vecteurs unitaires |
| `quatLookAt(forward, up?)` | Rotation orientée vers `forward`, up par défaut `(0, 1, 0)` |

### Opérations

| Fonction | Description |
|---|---|
| `quatMultiply(a, b)` | Composition — applique `b` puis `a` |
| `quatDot(a, b)` | Produit scalaire (utilisé pour l'interpolation) |
| `quatConjugate(q)` | Conjugué — inverse pour les quaternions unitaires |
| `quatInverse(q)` | Inverse (fonctionne aussi pour les non-unitaires) |
| `quatNormalize(q)` | Normalisation à la longueur unitaire |
| `quatRotateVec3(q, v)` | Applique la rotation à un Vec3 |

### Interpolation

| Fonction | Description |
|---|---|
| `quatNlerp(a, b, t)` | Lerp normalisé — moins coûteux, vitesse angulaire légèrement non uniforme |
| `quatSlerp(a, b, t)` | Lerp sphérique — vitesse angulaire constante |

### Conversion

| Fonction | Description |
|---|---|
| `quatToEuler(q)` | Extrait les angles d'Euler en `Vec3` (radians, ordre YXZ) |
| `quatEquals(a, b, epsilon?)` | `true` si les deux représentent la même rotation |

```ts
import { quatFromEuler, quatSlerp, degToRad } from '@gwenjs/math'

const from = quatFromEuler(0, 0, 0)
const to   = quatFromEuler(0, degToRad(90), 0)
const mid  = quatSlerp(from, to, 0.5)  // 45° autour de Y
```

---

## Color

Tous les canaux sont dans `[0, 1]` (espace linéaire).

### Constructeurs

| Fonction | Description |
|---|---|
| `color(r, g, b, a?)` | Crée depuis des canaux normalisés `[0, 1]` (alpha par défaut `1`) |
| `colorWhite()` | `{ r: 1, g: 1, b: 1, a: 1 }` |
| `colorBlack()` | `{ r: 0, g: 0, b: 0, a: 1 }` |
| `colorTransparent()` | `{ r: 0, g: 0, b: 0, a: 0 }` |
| `colorFromHex(hex)` | Parse un hex CSS : `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` |
| `colorFromRGB255(r, g, b, a?)` | Depuis des canaux entiers `[0, 255]` |
| `colorFromHSL(h, s, l, a?)` | Depuis teinte `[0, 360]`, saturation/luminosité `[0, 1]` |
| `colorClone(c)` | Copie superficielle |

### Opérations

| Fonction | Description |
|---|---|
| `colorToHex(c)` | Sérialise en chaîne `#RRGGBBAA` |
| `colorToHSL(c)` | Retourne `{ h, s, l, a }` |
| `colorLerp(a, b, t)` | Interpolation linéaire entre deux couleurs |
| `colorPremultiply(c)` | Prémultiplie l'alpha dans les canaux RGB (pour WebGL) |
| `colorClamp(c)` | Limite tous les canaux à `[0, 1]` |

```ts
import { colorFromHex, colorLerp, colorFromHSL } from '@gwenjs/math'

const rouge  = colorFromHex('#ff0000')
const bleu   = colorFromHex('#0000ff')
const violet = colorLerp(rouge, bleu, 0.5)

const ciel   = colorFromHSL(200, 0.8, 0.6)  // teinte=200, s=80%, l=60%
```

---

## Vec4

Utilisé pour les coordonnées homogènes et les données à 4 composantes.

### Constructeurs

| Fonction | Description |
|---|---|
| `vec4(x, y, z, w)` | Crée |
| `vec4Zero()` | `(0, 0, 0, 0)` |
| `vec4One()` | `(1, 1, 1, 1)` |
| `vec4Point(x, y, z)` | `(x, y, z, 1)` — point homogène |
| `vec4Dir(x, y, z)` | `(x, y, z, 0)` — direction homogène |
| `vec4Clone(v)` | Copie superficielle |

### Opérations

| Fonction | Description |
|---|---|
| `vec4Add(a, b)` / `vec4AddMut(a, b)` | Addition |
| `vec4Sub(a, b)` / `vec4SubMut(a, b)` | Soustraction |
| `vec4Scale(v, s)` / `vec4ScaleMut(v, s)` | Mise à l'échelle |
| `vec4Mul(a, b)` | Multiplication composante par composante |
| `vec4Negate(v)` | Négation |
| `vec4Dot(a, b)` | Produit scalaire |
| `vec4Length(v)` / `vec4LengthSq(v)` | Longueur / longueur au carré |
| `vec4Normalize(v)` | Vecteur unitaire |
| `vec4Lerp(a, b, t)` | Interpolation linéaire |
| `vec4Equals(a, b, epsilon?)` | Égalité approximative |
