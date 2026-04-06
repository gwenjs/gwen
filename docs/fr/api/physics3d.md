---
title: "@gwenjs/physics3d"
description: "Référence API pour @gwenjs/physics3d."
---

# @gwenjs/physics3d

`pnpm add @gwenjs/physics3d`

Plugin de moteur de physique 3D alimenté par Rapier3D. Fournit la dynamique des corps rigides, la détection de collisions et des fonctionnalités de physique 3D avancées.

## Configuration du plugin

### Physics3DPlugin(options?)

**Signature:**
```ts
function Physics3DPlugin(options?: Physics3DPluginOptions): PluginDef
```

**Description.** Crée le plugin de physique 3D avec configuration optionnelle.

**Retourne:** `PluginDef` — définition du plugin de physique.

**Exemple:**
```ts
export default defineConfig({
  plugins: [Physics3DPlugin({ quality: 'high' })],
  wasm: 'physics3d',
  // ...
});
```

## Configuration

### normalizePhysics3DConfig(input)

**Signature:**
```ts
function normalizePhysics3DConfig(input?: Partial<Physics3DConfig>): Physics3DConfig
```

**Description.** Normalise et valide la configuration de physique 3D.

**Retourne:** `Physics3DConfig` — configuration validée.

### Physics3DConfig

**Signature:**
```ts
interface Physics3DConfig {
  gravity: Physics3DVec3;
  quality: Physics3DQualityPreset;
  maxBodies?: number;
  maxColliders?: number;
  numSolverIterations?: number;
}
```

### QUALITY_PRESETS

**Signature:**
```ts
const QUALITY_PRESETS: {
  low: Physics3DQualityPreset;
  medium: Physics3DQualityPreset;
  high: Physics3DQualityPreset;
}
```

**Description.** Préconfigurations de qualité équilibrant l'exactitude et la performance.

**Exemple:**
```ts
const config = {
  quality: QUALITY_PRESETS.high
};
```

## Service de physique

### usePhysics3D()

**Signature:**
```ts
function usePhysics3D(): Physics3DAPI
```

**Description.** Retourne le service de physique 3D pour les requêtes et manipulations à l'exécution.

**Retourne:** `Physics3DAPI` — API d'exécution de physique.

**Exemple:**
```ts
const physics = usePhysics3D();
physics.applyImpulse(entity, { x: 10, y: 0, z: 0 });
```

### Physics3DAPI

**Méthodes:**

| Méthode | Signature | Description |
|---|---|---|
| `applyImpulse` | `(entity: Entity, impulse: Physics3DVec3) => void` | Applique une force instantanée |
| `applyForce` | `(entity: Entity, force: Physics3DVec3) => void` | Applique une force continue |
| `applyTorque` | `(entity: Entity, torque: Physics3DVec3) => void` | Applique une force rotationnelle |
| `setVelocity` | `(entity: Entity, velocity: Physics3DVec3) => void` | Définit la vélocité du corps |
| `getVelocity` | `(entity: Entity) => Physics3DVec3` | Obtient la vélocité du corps |
| `setAngularVelocity` | `(entity: Entity, av: Physics3DVec3) => void` | Définit la vélocité angulaire |
| `getAngularVelocity` | `(entity: Entity) => Physics3DVec3` | Obtient la vélocité angulaire |
| `raycast` | `(from: Physics3DVec3, direction: Physics3DVec3, options?: RaycastOptions) => RaycastHit[]` | Lance un rayon |
| `setGravity` | `(gravity: Physics3DVec3) => void` | Définit la gravité du monde |
| `getGravity` | `() => Physics3DVec3` | Obtient la gravité du monde |
| `shapeCast` | `(shape: string, from: Physics3DVec3, direction: Physics3DVec3) => ShapeCastHit[]` | Lance une forme (balayage) |

**Exemple:**
```ts
const physics = usePhysics3D();
const hits = physics.raycast(
  { x: 0, y: 0, z: 0 },
  { x: 0, y: -1, z: 0 }
);
```

## Composables

Utilisez ceux-ci à l'intérieur de `defineActor` pour ajouter des composants de physique 3D.

### useDynamicBody3D(options?)

**Signature:**
```ts
function useDynamicBody3D(options?: Physics3DBodyOptions): void
```

**Description.** Ajoute un corps rigide dynamique affecté par la gravité et les forces.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `Physics3DBodyOptions` | Configuration du corps |

**Retourne:** `void`

**Exemple:**
```ts
defineActor('Sphere', (setup) => {
  useDynamicBody3D({ mass: 5, restitution: 0.6 });
  useSphereCollider3D({ radius: 1 });
});
```

### useStaticBody3D()

**Signature:**
```ts
function useStaticBody3D(): void
```

**Description.** Ajoute un corps statique (immobile). À utiliser pour le terrain et les obstacles statiques.

**Retourne:** `void`

### useKinematicBody3D(options?)

**Signature:**
```ts
function useKinematicBody3D(options?: Physics3DBodyOptions): void
```

**Description.** Ajoute un corps cinématique (contrôlé par la vélocité, non affecté par la gravité).

**Retourne:** `void`

## Colliders

### useBoxCollider3D(options)

**Signature:**
```ts
function useBoxCollider3D(options: {
  extents: Physics3DVec3;
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Ajoute un collider de boîte 3D.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.extents | `Physics3DVec3` | Demi-taille en x, y, z |
| options.sensor | `boolean` | Collider déclenchement uniquement |
| options.density | `number` | Densité de collision |

**Retourne:** `void`

**Exemple:**
```ts
useBoxCollider3D({
  extents: { x: 1, y: 2, z: 1 },
  sensor: false
});
```

### useSphereCollider3D(options)

**Signature:**
```ts
function useSphereCollider3D(options: {
  radius: number;
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Ajoute un collider de sphère 3D.

**Retourne:** `void`

### useCapsuleCollider3D(options)

**Signature:**
```ts
function useCapsuleCollider3D(options: {
  radius: number;
  halfHeight: number;
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Ajoute un collider de capsule 3D.

**Retourne:** `void`

### useConvexCollider3D(options)

**Signature:**
```ts
function useConvexCollider3D(options: {
  vertices: Physics3DVec3[];
  sensor?: boolean;
  density?: number;
}): void
```

**Description.** Ajoute un collider de maille convexe.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.vertices | `Physics3DVec3[]` | Sommets de l'enveloppe convexe |
| options.sensor | `boolean` | Déclenchement uniquement |
| options.density | `number` | Densité de collision |

**Retourne:** `void`

### useMeshCollider3D(options)

**Signature:**
```ts
function useMeshCollider3D(options: {
  vertices: Physics3DVec3[];
  indices?: number[];
  sensor?: boolean;
}): void
```

**Description.** Ajoute un collider trimesh (maille arbitraire). Pour géométrie statique uniquement.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.vertices | `Physics3DVec3[]` | Sommets de la maille |
| options.indices | `number[]` | Indices des triangles (optionnel) |
| options.sensor | `boolean` | Déclenchement uniquement |

**Retourne:** `void`

### useCompoundCollider3D(options)

**Signature:**
```ts
function useCompoundCollider3D(options: {
  shapes: ColliderShape3D[];
  sensor?: boolean;
}): void
```

**Description.** Ajoute un collider composé (plusieurs formes dans un).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.shapes | `ColliderShape3D[]` | Tableau de définitions de collider |
| options.sensor | `boolean` | Déclenchement uniquement |

**Retourne:** `void`

## Événements de collider

### onContact3D(handler)

**Signature:**
```ts
function onContact3D(handler: (event: ContactEvent3D) => void): void
```

**Description.** Enregistre un gestionnaire pour les événements de collision 3D.

**Exemple:**
```ts
defineActor('Player', (setup) => {
  onContact3D((event) => {
    console.log('Collided with:', event.other.name);
  });
});
```

### onSensor3DEnter(handler)

**Signature:**
```ts
function onSensor3DEnter(handler: (other: Entity) => void): void
```

**Description.** Appelé quand un autre collider entre dans un déclencheur de capteur.

### onSensor3DExit(handler)

**Signature:**
```ts
function onSensor3DExit(handler: (other: Entity) => void): void
```

**Description.** Appelé quand un autre collider quitte un déclencheur de capteur.

## Optimisation des colliders de maille

### preloadMeshCollider(handle)

**Signature:**
```ts
function preloadMeshCollider(handle: MeshHandle): Promise<void>
```

**Description.** Pré-calcule une Hiérarchie de Volume Englobant (BVH) pour un collider de maille, améliorant la performance du raycasting et de la détection de collisions. À appeler avant d'ajouter le collider à la physique.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| handle | `MeshHandle` | Poignée de ressource de maille |

**Retourne:** `Promise<void>`

**Exemple:**
```ts
const mesh = loadMesh('terrain.gltf');
await preloadMeshCollider(mesh);
useMeshCollider3D({ vertices: mesh.vertices });
```

## Constantes

| Constante | Valeur | Description |
|---|---|---|
| `EVENT_STRIDE_3D` | - | Stride des données d'événement pour physique 3D |
| `MAX_EVENTS_3D` | - | Événements maximum par frame |
| `COLLIDER_ID_ABSENT` | - | Valeur sentinelle pour ID de collider absent |
| `RING_CAPACITY_3D` | - | Capacité du buffer en anneau |

## Intégration Vite

### physics3dVitePlugin()

**Signature:**
```ts
function physics3dVitePlugin(): VitePlugin
```

**Description.** Plugin Vite pour bundler Rapier3D WASM. Enregistré automatiquement quand le plugin physics3d est utilisé.

**Retourne:** `VitePlugin`

### createGwenPhysics3DPlugin()

**Signature:**
```ts
function createGwenPhysics3DPlugin(options?: Physics3DPluginOptions): PluginDef
```

**Description.** Fonction de fabrique pour créer un plugin de physique 3D avec des options personnalisées.

**Retourne:** `PluginDef`

## Définitions de type

### Physics3DAPI

**Signature:**
```ts
interface Physics3DAPI {
  applyImpulse(entity: Entity, impulse: Physics3DVec3): void;
  applyForce(entity: Entity, force: Physics3DVec3): void;
  applyTorque(entity: Entity, torque: Physics3DVec3): void;
  setVelocity(entity: Entity, velocity: Physics3DVec3): void;
  getVelocity(entity: Entity): Physics3DVec3;
  setAngularVelocity(entity: Entity, av: Physics3DVec3): void;
  getAngularVelocity(entity: Entity): Physics3DVec3;
  raycast(from: Physics3DVec3, direction: Physics3DVec3, options?: RaycastOptions): RaycastHit[];
  shapeCast(shape: string, from: Physics3DVec3, direction: Physics3DVec3): ShapeCastHit[];
  setGravity(gravity: Physics3DVec3): void;
  getGravity(): Physics3DVec3;
}
```

### Physics3DBodyOptions

```ts
interface Physics3DBodyOptions {
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  restitution?: number;
  friction?: number;
  ccdEnabled?: boolean;
  dominance?: number;
}
```

### Physics3DVec3

```ts
interface Physics3DVec3 {
  x: number;
  y: number;
  z: number;
}
```

### Physics3DQuat

```ts
interface Physics3DQuat {
  x: number;
  y: number;
  z: number;
  w: number;
}
```

### Physics3DQualityPreset

```ts
type Physics3DQualityPreset = {
  numSolverIterations: number;
  numAdditionalFrictionIterations: number;
  numInternalPgsIterations: number;
  maxCcdSubsteps: number;
}
```
