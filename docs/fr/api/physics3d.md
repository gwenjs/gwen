---
title: "@gwenjs/physics3d"
description: "Référence API pour @gwenjs/physics3d."
---

# @gwenjs/physics3d

`pnpm add @gwenjs/physics3d`

Module de moteur physique 3D propulsé par Rapier3D. Fournit la dynamique des corps rigides, la détection de collisions, les événements de capteur, le filtrage par calques et les colliders de maillage accélérés par BVH.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import {
  Physics3DPlugin,
  onSensorEnter,
  useBoxCollider,
  useDynamicBody,
} from "@gwenjs/physics3d";
import type { BoxColliderHandle3D, DynamicBodyHandle3D } from "@gwenjs/physics3d";

const plugin = Physics3DPlugin({ gravity: { y: -9.81 } });

const Position = defineComponent({
  name: "DocsPhysics3dPos",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
  defaults: { x: 0, y: 0, z: 0 },
});

const CratePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0, z: 0 } }]);

export const CrateActor = defineActor(CratePrefab, () => {
  const body: DynamicBodyHandle3D = useDynamicBody({ mass: 5, fixedRotation: true });
  const zone: BoxColliderHandle3D = useBoxCollider({ w: 1, h: 1, d: 1, isSensor: true });
  onSensorEnter(zone.colliderId, (entityId) => {
    void entityId;
    void body;
  });
});

void plugin;
```

## Configuration du module

Enregistrez le module dans `gwen.config.ts` :

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics3d'],
  physics3d: {
    gravity: { x: 0, y: -9.81, z: 0 },
    maxEntities: 10_000,
    qualityPreset: 'medium',
    debug: false,
    coalesceEvents: true,
    maxLinearVelocity: 400,
    layers: { default: 0, player: 1, enemy: 2 },
    vite: {
      bvhPrebake: false,
    },
  },
})
```

### Physics3DConfig

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `gravity` | `Partial<Vec3>` | `{ x: 0, y: -9.81, z: 0 }` | Vecteur de gravité. Un composant manquant utilise le composant par défaut (x 0, y -9.81, z 0) (`packages/physics3d/src/config.ts:21`). |
| `maxEntities` | `number` | `10_000` | Nombre maximum d'entités physiques |
| `qualityPreset` | `QualityPreset` | `'medium'` | Qualité du solveur : `'low'`, `'medium'`, `'high'` ou `'esport'` |
| `debug` | `boolean` | `false` | Active les journaux de débogage physique à l'exécution |
| `coalesceEvents` | `boolean` | `true` | Fusionne les événements de contact dupliqués dans une frame |
| `maxLinearVelocity` | `number` | `400` | Plafond de vitesse linéaire (m/s). Aussi le plafond Rapier après chaque sous-pas. Un corps dynamique plus rapide est ramené à ce plafond et reste actif |
| `layers` | `Record<string, number>` | `{}` | Nom de calque vers un indice de bit, entiers `0..31`, 32 au plus |
| `vite` | `object` | — | Options du plugin Vite au moment du build (voir ci-dessous) |
| `vite.bvhPrebake` | `boolean` | `false` | Pré-compile le BVH pour `useMeshCollider('./x.glb')` au moment du build |

## Comportement Rapier 0.36

Rapier limite la vitesse linéaire après chaque sous-pas du solveur. Le plafond par défaut est 400 m/s. `maxLinearVelocity` règle le plafond de GWEN et ce plafond Rapier (`crates/gwen-core/src/physics2d/world.rs:752-753`, `crates/gwen-core/src/physics3d/world.rs:809-810`). Un nouveau monde part de 400 (`crates/gwen-core/src/physics2d/world.rs:200`, `crates/gwen-core/src/physics3d/world.rs:714`). Une valeur non finie, nulle ou négative est refusée et les deux plafonds restent.

Un corps s'endort après une demi-seconde sous le seuil de sommeil (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). Une île s'endort une fois que chaque corps qui la compose est éligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

Avec un sous-pas de CCD, une boîte dynamique rapide ne traverse pas un mur fixe mince, même si son propre drapeau CCD est éteint (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). Le préréglage Low garde ce sous-pas (`crates/gwen-core/src/physics_common/quality.rs:43-47`). Zéro sous-pas coupe cette CCD, et la même boîte traverse le mur (`crates/gwen-core/src/physics2d/world.rs:1711`).

Des itérations de solveur en plus ajoutent des sous-pas pour toute l'île qui contient le corps. En 2D, `additionalSolverIterations` est stocké à 16 au plus (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:19`, `crates/gwen-core/src/physics2d/world.rs:252`). En 3D, `set_body_solver_iterations` utilise le même plafond 0–16 (`crates/gwen-core/src/physics3d/world.rs:341`, `crates/gwen-core/src/physics3d/world.rs:2805-2807`). 0 n'ajoute aucun sous-pas. 17 et au-dessus sont stockés comme 16. Le plugin physics3d invoque `physics3d_set_body_solver_iterations` seulement quand le nombre choisi est supérieur à 0 (`packages/physics3d/src/plugin/body-management.ts:277-280`).

## Composables

Tous les composables sont importés depuis `@gwenjs/physics3d` et doivent être appelés à l'intérieur de `defineActor`.

### Corps

#### useDynamicBody(options?)

```ts
function useDynamicBody(options?: DynamicBodyOptions3D): DynamicBodyHandle3D
```

Ajoute un corps dynamique. Champs copiés : `mass?`, `gravityScale?`, `linearDamping?`, `angularDamping?`, `ccdEnabled?`, `initialPosition?`, `initialRotation?`, `initialLinearVelocity?`, `initialAngularVelocity?`, `fixedRotation?`, `quality?`. `layer`, `mask`, `material` et `isSensor` sont sur le type et ne sont pas copiés. Il n'y a pas de champ `restitution`.

**Retourne :** `DynamicBodyHandle3D`

```ts
import { useDynamicBody, useSphereCollider } from '@gwenjs/physics3d'

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 5, fixedRotation: true })
  useSphereCollider({ radius: 1 })
  void body
})
```

#### useStaticBody(options?)

```ts
function useStaticBody(options?: StaticBodyOptions3D): StaticBodyHandle3D
```

Ajoute un corps fixe. `StaticBodyOptions3D` liste `isSensor`, `layer`, `mask` et `material`. `useStaticBody` ne les lit pas. Le handle a `bodyId`, `active`, `enable()` et `disable()`.

```ts
import { useStaticBody, useMeshCollider } from '@gwenjs/physics3d'

export const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider('./terrain.glb')
})
```

#### useKinematicBody(options?)

```ts
function useKinematicBody(options?: KinematicBodyOptions3D): KinematicBodyHandle3D
```

Ajoute un corps cinématique. Champs : `initialPosition?`, `initialRotation?`, `fixedRotation?`. La gravité ne le déplace pas.

**Retourne :** `KinematicBodyHandle3D`

```ts
import { useKinematicBody, useCapsuleCollider } from '@gwenjs/physics3d'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const body = useKinematicBody({ fixedRotation: true })
  useCapsuleCollider({ radius: 0.4, height: 1.2 })
  void body
})
```

### Colliders

#### useBoxCollider(options)

```ts
function useBoxCollider(options: BoxColliderOptions3D): BoxColliderHandle3D
```

Attache une boîte au corps déjà enregistré par `useStaticBody` ou `useDynamicBody`. `w`, `h` et `d` sont des tailles pleines. `d` vaut `w` par défaut. Les demi-tailles sont ces tailles divisées par 2. Optionnels : `offsetX`, `offsetY`, `offsetZ`, `isSensor`, `layer`, `mask`, `material`.

```ts
useBoxCollider({ w: 1, h: 2, d: 1 })
```

#### useSphereCollider(options)

```ts
function useSphereCollider(options: SphereColliderOptions3D): SphereColliderHandle3D
```

Attache une sphère au corps déjà enregistré sur cette entité. Champs : `radius`, et en option `offsetX`, `offsetY`, `offsetZ`, `isSensor`, `layer`, `mask`, `material`.

```ts
useSphereCollider({ radius: 0.5 })
```

#### useCapsuleCollider(options)

```ts
function useCapsuleCollider(options: CapsuleColliderOptions3D): CapsuleColliderHandle3D
```

Attache une capsule au corps déjà enregistré sur cette entité. `height` est la longueur du cylindre. La demi-hauteur stockée est `height / 2`. `axis` est accepté et n'est pas appliqué. Les autres champs optionnels sont ceux de la sphère.

```ts
useCapsuleCollider({ radius: 0.4, height: 1.2 })
```

#### useMeshCollider(path | options)

```ts
function useMeshCollider(source: string | {
  vertices: Float32Array
  indices: Uint32Array
  sensor?: boolean
}): void
```

Ajoute un collider de maillage triangulé (maille polygonale arbitraire). Destiné à la géométrie statique uniquement. Accepte soit un chemin `.glb` (résolu au moment du build lorsque le pré-calcul BVH est activé), soit des données de sommets/indices explicites.

```ts
// Basé sur un chemin (déclenche le pré-calcul BVH quand vite.bvhPrebake est true)
useMeshCollider('./terrain.glb')

// Données de sommets manuelles
useMeshCollider({ vertices: myFloat32Array, indices: myUint32Array })
```

#### useConvexCollider(options)

```ts
function useConvexCollider(options: {
  vertices: Float32Array
  isSensor?: boolean
  layer?: number | string | readonly (number | string)[]
  mask?: number | string | readonly (number | string)[]
  material?: string
}): { colliderId: number; remove(): void }
```

Ajoute un collider d'enveloppe convexe à partir d'un nuage de sommets (`packages/physics3d/src/composables/use-convex-collider.ts:21`). Plus rapide qu'un trimesh ; adapté aux corps dynamiques. Un chemin `.glb` n'est pas accepté.

```ts
useConvexCollider({ vertices: new Float32Array(12) })
```

### Événements

Les callbacks de capteur inscrits dans un acteur sont retirés à la destruction de cet acteur. `onContact` reste jusqu'à l'appel de la fonction qu'il renvoie, ou jusqu'au teardown du plugin.

#### onContact(callback)

```ts
function onContact(callback: (contact: CollisionContact) => void): () => void
```

Enregistre un callback pour chaque contact de ce moteur. Il n'est pas limité à un acteur. Le callback reçoit `entityA`, `entityB`, `aColliderId` et `bColliderId` optionnels, et `started`.

```ts
import { onContact } from '@gwenjs/physics3d'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  onContact((event) => {
    if (event.started) {
      console.log('Contact', event.entityA, event.entityB, event.aColliderId, event.bColliderId)
    }
  })
})
```

#### onSensorEnter(sensorId, callback)

```ts
function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void
```

Appelé quand une entité entre dans le capteur `sensorId`. Dans un acteur, le callback est stocké pour cet acteur. La valeur de retour retire le callback.

```ts
import { useStaticBody, useBoxCollider, onSensorEnter } from '@gwenjs/physics3d'

export const TriggerZone = defineActor(TriggerPrefab, () => {
  useStaticBody()
  const zone = useBoxCollider({ w: 3, h: 1, d: 3, isSensor: true })
  onSensorEnter(zone.colliderId, (entityId) => {
    console.log('Entity entered zone:', entityId)
  })
})
```

#### onSensorExit(sensorId, callback)

```ts
function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): () => void
```

Appelé quand une entité quitte le capteur `sensorId`. Même portée d'acteur et même valeur de retour que `onSensorEnter`.

### Calques

#### defineLayers(definition)

```ts
function defineLayers(definition: Record<string, number>): Record<string, number>
```

Renvoie une copie superficielle du dictionnaire de masques. Si deux valeurs partagent des bits, elle écrit un avertissement dans la console. `defineLayers` travaille avec des masques, tandis que `Physics3DConfig.layers` prend des index de bits 0..31.

```ts
import { defineLayers } from '@gwenjs/physics3d'

const Layers = defineLayers({ default: 1, player: 2, enemy: 4 })
// Layers.default === 1, Layers.player === 2, Layers.enemy === 4

useBoxCollider({
  w: 1,
  h: 1,
  d: 1,
})
```

## Service physique

### usePhysics3D()

```ts
function usePhysics3D(): Physics3DAPI
```

Retourne l'API physique d'exécution pour les opérations impératives. À appeler dans `defineSystem` ou `defineActor`.

```ts
import { usePhysics3D } from '@gwenjs/physics3d'

const physics = usePhysics3D()
physics.applyImpulse(entityId, { x: 0, y: 500, z: 0 })
```

### Méthodes de Physics3DAPI

| Méthode | Signature | Description |
|---|---|---|
| `applyImpulse` | `(entityId: EntityId, impulse: Partial<Vec3>) => boolean` | Applique une impulsion linéaire instantanée (N·s) |
| `applyAngularImpulse` | `(entityId: EntityId, impulse: Partial<Vec3>) => boolean` | Applique une impulsion angulaire instantanée |
| `addForce` | `(entityId: EntityId, force: Partial<Vec3>) => void` | Accumule une force continue pour ce step (N) |
| `addTorque` | `(entityId: EntityId, torque: Partial<Vec3>) => void` | Accumule un couple continu pour ce step (N·m) |
| `setLinearVelocity` | `(entityId: EntityId, velocity: Partial<Vec3>) => boolean` | Remplace la vélocité linéaire (m/s) |
| `getLinearVelocity` | `(entityId: EntityId) => Vec3 \| undefined` | Lit la vélocité linéaire actuelle |
| `setAngularVelocity` | `(entityId: EntityId, velocity: Partial<Vec3>) => boolean` | Remplace la vélocité angulaire (rad/s) |
| `getAngularVelocity` | `(entityId: EntityId) => Vec3 \| undefined` | Lit la vélocité angulaire actuelle |
| `setGravityScale` | `(entityId: EntityId, scale: number) => void` | Échelle de gravité par corps (`0` désactive, `1` = normal) |
| `getGravityScale` | `(entityId: EntityId) => number` | Lit l'échelle de gravité actuelle d'un corps |
| `castRay` | `(origin: Vec3, direction: Vec3, maxDist: number, opts?) => RayHit \| null` | Lance un rayon, retourne l'impact le plus proche ou `null` |

```ts
const physics = usePhysics3D()

// Saut
physics.applyImpulse(entityId, { x: 0, y: 300, z: 0 })

// Vérification du sol
const hit = physics.castRay(
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  1.1,
)
const isGrounded = hit !== null
```

## Événements

### physics3d:body-disabled

Le plugin émet ce hook après un pas qui a désactivé un corps. La charge est `{ entity, reason }`. `reason` vaut `non-finite`, `out-of-bounds` ou `velocity`. Le corps reste enregistré. Une requête ou `getBodyState` répond encore. Un corps dynamique et un corps mis en quarantaine par Rapier sont tous les deux inclus (`crates/gwen-core/src/physics3d/world.rs:1021`).

```ts
engine.hooks.hook("physics3d:body-disabled", ({ entity, reason }) => {
  // reason vaut "non-finite", "out-of-bounds" ou "velocity"
  void entity;
  void reason;
});
```

`non-finite` signifie qu'une translation ou une vitesse linéaire dynamique n'est pas finie, ou que Rapier a mis le corps en quarantaine, y compris une cible cinématique non finie. `out-of-bounds` signifie qu'une position dynamique sort de ±1e7. `velocity` signifie qu'une position dynamique après le plafond de vitesse sortirait de ±1e7.

Le plafond par défaut de 400 m/s ralentit un corps dynamique plus rapide. Un delta de pas au-dessus de 1 s est refusé avec `PHYSICS3D:INVALID_STEP_DELTA`.

## Erreurs

Un appel WASM `@gwenjs/physics3d` refusé lève un `GwenWasmError`. `code` commence par `PHYSICS3D:` ou vaut `CORE:INVALID_SHARED_BUFFER`, et `exportName` est l'export WASM. `cause` est l'erreur d'origine. Un piège lève `GwenWasmPanicError` et empoisonne le pont. Ces erreurs ne sont pas émises sur le [bus d'erreurs](/fr/advanced/error-bus).

```ts
import { GwenWasmError } from '@gwenjs/core'

try {
  physics.addRevoluteJoint({ bodyA, bodyB })
} catch (err) {
  if (err instanceof GwenWasmError && err.code === 'PHYSICS3D:INVALID_JOINT') {
    // Une valeur d'articulation était NaN ou infinie
  }
}
```

| Code | Levé quand |
|---|---|
| `NOT_INITIALIZED` | Un export touche le monde avant son initialisation |
| `BODY_NOT_FOUND` | Aucun corps rigide n'est enregistré pour le slot |
| `BODY_ALREADY_EXISTS` | Le slot a déjà un corps. Le premier corps est conservé |
| `INVALID_BODY_KIND` | Le type de corps n'est pas 0 (fixe), 1 (dynamique) ou 2 (cinématique) |
| `BUFFER_LENGTH_MISMATCH` | Les tampons parallèles d'un appel groupé ont des longueurs différentes |
| `COLLIDER_NOT_FOUND` | Aucun collider n'est enregistré pour ce slot et cet id |
| `COLLIDER_ALREADY_EXISTS` | L'id du collider est déjà enregistré pour le slot |
| `INVALID_SHAPE` | Les données de forme ne permettent pas de construire un collider (index de maillage hors limites, heightfield trop petit ou au mauvais nombre d'échantillons, enveloppe convexe de moins de 4 points ou dégénérée) |
| `INVALID_MESH_BUFFER` | La longueur des positions ou des indices d'un maillage n'est pas un multiple de 3 |
| `INVALID_COMPOUND` | La longueur d'un tampon composé n'est pas un multiple de 12, ou une partie a une forme inconnue |
| `BVH_LOAD_FAILED` | Un BVH précalculé est trop court, a un en-tête incorrect, a été précalculé pour une autre version de Rapier, ou ne se décode pas en maillage valide |
| `INVALID_COLLIDER` | Une taille, un rayon, un décalage, une densité ou une marge de peau est NaN, infini, négatif ou trop grand |
| `JOINT_NOT_FOUND` | Aucune articulation n'est enregistrée pour cet id |
| `INVALID_JOINT` | Un ancrage, un axe, une valeur de ressort, de moteur ou une limite d'articulation est NaN ou infini |
| `CHARACTER_CONTROLLER_NOT_FOUND` | Aucun contrôleur de personnage n'est enregistré pour le slot |
| `CHARACTER_CONTROLLER_LIMIT_REACHED` | Les 32 emplacements de contrôleur de personnage sont utilisés |
| `NAVGRID_NOT_INITIALIZED` | Une requête de chemin a eu lieu avant l'envoi de la grille de navigation |
| `INVALID_NAVGRID` | Une dimension de la grille est nulle, le nombre de cellules déborde, la grille dépasse 64 au cube, ou le nombre d'octets des cellules diffère du nombre de cellules |
| `INVALID_PATH_REQUEST` | Une coordonnée de chemin n'est pas finie ou dépasse la borne acceptée |
| `INVALID_QUERY` | Une coordonnée de rayon ou de point n'est pas finie ou sort de ±1e7, une direction n'est pas finie ou est nulle, ou une distance max n'est pas finie ou est négative |
| `INVALID_STEP_DELTA` | Un `delta` de pas n'est pas fini ou sort de 0 à 1. Le monde ne change pas |

`findPath3D` fait exception : sans grille de navigation envoyée, elle renvoie un tableau vide au lieu de lever `NAVGRID_NOT_INITIALIZED`.

Une lecture groupée dont le pointeur de sortie n'est pas un tampon partagé actif lève `CORE:INVALID_SHARED_BUFFER`.

## Intégration Vite

### physics3dVitePlugin(options?)

```ts
function physics3dVitePlugin(options?: GwenPhysics3DPluginOptions): VitePlugin
// import { physics3dVitePlugin } from '@gwenjs/physics3d/module'
```

Plugin Vite au moment du build. Il est **enregistré automatiquement** par le module `@gwenjs/physics3d` — aucune inscription manuelle n'est nécessaire dans la plupart des projets. Configurez-le via la clé `vite` dans les options du module.

```ts
interface GwenPhysics3DPluginOptions {
  bvhPrebake?: boolean // défaut : false — pré-compile le BVH pour les chemins de collider de maillage
}
```

Le plugin fait deux travaux au moment du build :

1. **Intégration des calques** — enregistre `gwen:layer-inline` sur `gwen:transform-pipeline`. `Layers.player` devient son masque de bits. Une config Vite manuelle exige `gwen()` dans la config Vite.
2. **Pré-calcul BVH** (opt-in) — `useMeshCollider('./terrain.glb')` (un chemin `../` aussi) est réécrit en `useMeshCollider({ __bvhUrl: "bvh-<hash>.bin" })`. Le build émet ce fichier. En dev, les mêmes octets sont servis en mémoire. Un fichier absent ou un calcul en échec lève `VITE:BVH_PREBAKE_FAILED`. `useConvexCollider` n'est pas réécrit.

:::tip Flux de travail BVH pre-bake
Activez `bvhPrebake: true` (via `vite.bvhPrebake` dans la configuration du module) pour les grands maillages de terrain. Le BVH est compilé une seule fois au moment du build et servi sous forme d'asset binaire, de sorte que l'initialisation du raycast à l'exécution est quasi instantanée — sans coût de reconstruction BVH par frame.
:::

## Définitions de type

### Physics3DConfig

```ts
interface Physics3DConfig extends PhysicsConfigBase<'3d'> {
  gravity?: Partial<Vec3>
  maxEntities?: number
  qualityPreset?: QualityPreset
  debug?: boolean
  coalesceEvents?: boolean
  maxLinearVelocity?: number
  layers?: Record<string, number>
  vite?: {
    bvhPrebake?: boolean
  }
}
```

Dans toute cette page, les formes de vecteur et de rotation sont `Vec3` et `Quat` de `@gwenjs/math`, et les identifiants d'entité sont `EntityId` de `@gwenjs/schema`.

### QualityPreset

```ts
type QualityPreset = 'low' | 'medium' | 'high' | 'esport'
```

### DynamicBodyOptions3D

Champs copiés sur le corps : `mass?`, `gravityScale?`, `linearDamping?`, `angularDamping?`, `ccdEnabled?`, `initialPosition?` (`Partial<Vec3>`), `initialRotation?` (`Partial<Quat>`), `initialLinearVelocity?`, `initialAngularVelocity?`, `fixedRotation?`, `quality?` (`QualityPreset`). `layer`, `mask`, `material` et `isSensor` sont sur le type et ne sont pas copiés. Il n'y a pas de champ `restitution`.

### ColliderHandle3D

`useBoxCollider`, `useSphereCollider` et `useCapsuleCollider` renvoient `BoxColliderHandle3D`, `SphereColliderHandle3D` et `CapsuleColliderHandle3D`. Chacun de ces noms est `ColliderHandle3D` : `colliderId` et `remove()`.
