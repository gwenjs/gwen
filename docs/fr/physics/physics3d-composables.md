---
title: Composables Physics 3D
description: API centré sur les composables pour la physique de corps rigides 3D dans GWEN avec Rapier3D.
---

# Composables Physics 3D

**Package:** `@gwenjs/physics3d`

Les composables Physics 3D ajoutent la dynamique des corps rigides et les collisions aux acteurs dans l'espace tridimensionnel. Comme pour la 2D, ils sont appelés à l'intérieur de `defineActor()` et fonctionnent avec le graphe de scène. La physique 3D inclut des fonctionnalités avancées comme les raycasts, les shape casts et les colliders de mesh pour les environnements complexes.

## Les bases

Déclarez la physique 3D à l'intérieur de `defineActor()` — une fois par type d'acteur :

```ts
import { defineActor, onUpdate } from '@gwenjs/core'
import { useDynamicBody, useSphereCollider, useRaycast, onContact } from '@gwenjs/physics3d'

export const BallActor = defineActor('Ball', () => {
  const body = useDynamicBody({ mass: 2, ccdEnabled: true })
  useSphereCollider({ radius: 0.5 })

  onContact((contact) => {
    console.log('Hit something:', contact.other)
  })

  onUpdate(() => {
    // Update ball logic each frame
  })
})
```

Le plugin fait automatiquement :
- Enregistre le corps avec la simulation physique 3D
- Synchronise les formes de collider et les transformations
- Envoie les événements de collision
- Gère les raycasts, les shape casts et les chevauchements par image
- Nettoie quand l'acteur disparaît

## Corps

Chaque acteur a besoin d'exactement un composable de corps :

| Composable | Cas d'usage |
|---|---|
| `useDynamicBody(opts?)` | Entièrement simulé : gravité, forces, collisions. Personnages, véhicules, objets interactifs. |
| `useKinematicBody(opts?)` | Piloté manuellement : se déplace sur commande, ne répond pas aux forces. Ascenseurs, portes coulissantes, plateformes mobiles. |
| `useStaticBody()` | Ne bouge jamais : terrain, murs, structures immobiles. |

```ts
// Caisse en chute 3D
const CrateActor = defineActor('Crate', () => {
  useDynamicBody({ mass: 10, linearDamping: 0.2 })
  useBoxCollider({ w: 1, h: 1, d: 1 })
})

// Ascenseur se déplaçant sur une piste
const ElevatorActor = defineActor('Elevator', () => {
  const body = useKinematicBody()
  useBoxCollider({ w: 4, h: 0.5, d: 4 })

  onUpdate(({ time }) => {
    // Mouvement en onde sinusoïdale
    const y = Math.sin(time) * 5
    body.setPosition(0, y, 0)
  })
})

// Terrain (peut utiliser des colliders de mesh pour l'efficacité)
const TerrainActor = defineActor('Terrain', () => {
  useStaticBody()
  useMeshCollider({ vertices: terrainVerts, indices: terrainIndices })
})
```

## Colliders

Ajoutez des formes de collision avec des composables collider. Un acteur peut avoir plusieurs colliders :

| Composable | Forme | Meilleur pour |
|---|---|---|
| `useBoxCollider(opts)` | Boîte alignée sur les axes | Caisses, bâtiments, structures simples |
| `useSphereCollider(opts)` | Sphère | Balles, explosions, objets ronds |
| `useCapsuleCollider(opts)` | Capsule (cylindre arrondi) | Personnages, mouvement lisse |
| `useConvexCollider(opts)` | Enveloppe convexe des sommets | Formes irrégulières (rochers, astéroïdes) |
| `useCompoundCollider(opts)` | Plusieurs formes combinées | Objets complexes (robots, véhicules) |
| `useMeshCollider(opts)` | Mesh triangulaire (concave) | Terrain, environnement (corps statiques uniquement) |
| `useHeightfieldCollider(opts)` | Grille d'hauteur | Terrain à partir de heightmaps |

```ts
// Personnage avec capsule
const CharacterActor = defineActor('Character', () => {
  useDynamicBody({ mass: 1 })
  useCapsuleCollider({ radius: 0.4, length: 1.8 })
})

// Astéroïde avec enveloppe convexe
const AsteroidActor = defineActor('Asteroid', () => {
  useDynamicBody({ mass: 5 })
  useConvexCollider({
    vertices: asteroidVertices,
    offsetX: 0, offsetY: 0, offsetZ: 0
  })
})

// Robot avec collider composé (tête + corps + jambes)
const RobotActor = defineActor('Robot', () => {
  useDynamicBody({ mass: 50 })
  useCompoundCollider({
    shapes: [
      { type: 'box', w: 1, h: 2, d: 1, offsetY: 0.5 },    // corps
      { type: 'sphere', radius: 0.5, offsetY: 2 },         // tête
      { type: 'capsule', radius: 0.2, length: 1, offsetY: -0.5 } // jambes
    ]
  })
})

// Terrain avec collider de mesh (BVH préchargé pour l'efficacité)
const TerrainActor = defineActor('Terrain', () => {
  useStaticBody()
  const mesh = useMeshCollider('./terrain.glb')
  ready.then(() => console.log('Terrain collider loaded'))
})
```

### Options des colliders

**Tous les colliders acceptent :**
- `offsetX?: number`, `offsetY?: number`, `offsetZ?: number` — Décalage de position locale
- `isSensor?: boolean` — Événements de chevauchement uniquement, pas de réponse physique
- `layer?: number` — Masque de couche d'appartenance
- `mask?: number` — Masque de filtre de collision

**Collider de boîte :**
- `w: number` — Largeur (X)
- `h: number` — Hauteur (Y)
- `d: number` — Profondeur (Z)

**Sphère et capsule :**
- `radius: number` — Rayon

**Capsule :**
- `length: number` — Longueur de la section cylindrique

**Collider convexe :**
- `vertices: Float32Array` — Positions des sommets [x, y, z, x, y, z, ...]

**Collider de mesh (concave) :**
- `vertices?: Float32Array` — Positions des sommets
- `indices?: Uint32Array` — Indices de triangles
- `__bvhUrl?: string` — URL du BVH pré-balisé (asynchrone, recommandé)

**Collider heightfield :**
- `heights: Float32Array` — Valeurs d'hauteur dans une grille
- `scale: Vec3` — Échelle du heightfield en X, Y, Z

## Événements

### Événements de contact

```ts
onContact((contact) => {
  console.log('Hit:', contact.other)
  console.log('Speed:', contact.relativeVelocity)
  console.log('Point:', contact.point)
  console.log('Normal:', contact.normal)
})
```

Objet `contact` :
- `other` — ID de l'entité qui entre en collision
- `relativeVelocity` — Vitesse relative au point de collision
- `point` — Point de collision dans l'espace du monde
- `normal` — Normale de surface

### Événements des capteurs

```ts
const sensor = useBoxCollider({ w: 2, h: 2, d: 2, isSensor: true })

onSensorEnter(sensor.colliderId, (entityId) => {
  console.log('Entity entered:', entityId)
})

onSensorExit(sensor.colliderId, (entityId) => {
  console.log('Entity left:', entityId)
})
```

## Requêtes

### Raycasts

Lancez des rayons pour la détection de coups (détection du sol, ligne de vue, etc.) :

```ts
const groundRay = useRaycast({
  origin: () => ({ x: player.x, y: player.y + 0.1, z: player.z }),
  direction: { x: 0, y: -1, z: 0 },
  maxDist: 0.5,
  layer: Layers.player,
  mask: Layers.terrain
})

onUpdate(() => {
  if (groundRay.hit) {
    console.log('On ground, distance:', groundRay.distance)
    console.log('Hit point:', groundRay.point)
  }
  
  // Appeler dispose() quand terminé (si le raycast était temporaire)
  // groundRay.dispose()
})
```

Options du raycast :
- `origin?: () => Vec3` — Fonction d'origine (mise à jour à chaque image)
- `direction: Vec3` — Direction du rayon (normalisée)
- `maxDist: number` — Distance maximale à rechercher
- `layer?: number` — Couche d'appartenance
- `mask?: number` — Masque de filtre
- `solid?: boolean` — Ignorer les capteurs (défaut: false)

Handle du raycast :
- `get hit(): boolean` — Si le rayon a touché quelque chose
- `get entity(): bigint | null` — ID de l'entité touchée
- `get distance(): number` — Distance au point d'impact
- `get point(): Vec3` — Point d'impact dans l'espace du monde
- `get normal(): Vec3` — Normale de surface au point d'impact
- `dispose(): void` — Désenregistrer le slot du raycast

### Shape Casts

Lancez une forme (boîte, sphère, capsule) pour vérifier les collisions le long d'un chemin :

```ts
const sweep = useShapeCast({
  shape: { type: 'sphere', radius: 0.5 },
  origin: { x: 0, y: 1, z: 0 },
  direction: { x: 1, y: 0, z: 0 },
  maxDist: 10,
  mask: Layers.terrain | Layers.enemy
})

onUpdate(() => {
  if (sweep.hit) {
    console.log('Obstacle ahead at distance:', sweep.distance)
  }
})
```

### Chevauchements

Vérifiez ce qui chevauche actuellement une forme :

```ts
const explosionZone = useOverlap({
  shape: { type: 'sphere', radius: 5 },
  position: explosionPos,
  layer: Layers.projectile,
  mask: Layers.enemy | Layers.player
})

onUpdate(() => {
  explosionZone.entities.forEach((entityId) => {
    console.log('Entity in blast radius:', entityId)
  })
})
```

## Articulations

Connectez deux corps avec des contraintes physiques :

```ts
const anchorBody = useDynamicBody()
const swingBody = useDynamicBody()

useJoint({
  bodyA: anchorBody.bodyId,
  bodyB: swingBody.bodyId,
  type: 'revolute',  // revolute, spherical, prismatic, fixed, rope, etc.
  anchorA: { x: 0, y: 1, z: 0 },
  anchorB: { x: 0, y: -1, z: 0 },
  limits: { min: -Math.PI / 2, max: Math.PI / 2 }
})
```

Types d'articulations :
- `'fixed'` — Connecter rigidement deux corps
- `'revolute'` — Articulation à charnière (rotation autour d'un axe)
- `'spherical'` — Articulation sphérique (rotation libre)
- `'prismatic'` — Articulation curseur (mouvement linéaire)
- `'rope'` — Contrainte de distance
- etc.

## Couches de collision

Utilisez les couches pour contrôler quels objets entrent en collision :

```ts
import { defineLayers } from '@gwenjs/physics3d'

export const Layers = defineLayers({
  player:    1 << 0,
  enemy:     1 << 1,
  terrain:   1 << 2,
  projectile: 1 << 3,
  debris:    1 << 4,
})

// Le joueur entre en collision avec le terrain uniquement
const PlayerActor = defineActor('Player', () => {
  useDynamicBody()
  useCapsuleCollider({
    radius: 0.4, length: 1.8,
    layer: Layers.player,
    mask: Layers.terrain
  })
})

// Le projectile entre en collision avec tout sauf les autres projectiles
const ProjectileActor = defineActor('Projectile', () => {
  useDynamicBody()
  useSphereCollider({
    radius: 0.1,
    layer: Layers.projectile,
    mask: Layers.player | Layers.enemy | Layers.terrain | Layers.debris
  })
})
```

## En pratique

### Contrôleur de personnage 3D

Un exemple complet : personnage avec gravité, détection du sol via raycast, et saut.

```ts
import { defineActor, onUpdate } from '@gwenjs/core'
import { useDynamicBody, useCapsuleCollider, useRaycast, onContact } from '@gwenjs/physics3d'
import { Layers } from './layers'

export const PlayerActor = defineActor('Player', () => {
  const body = useDynamicBody({
    mass: 1,
    gravityScale: 2,
    linearDamping: 0.1
  })

  useCapsuleCollider({
    radius: 0.4,
    length: 1.8,
    offsetY: 0.9,  // Élever le collider pour correspondre au visuel
    layer: Layers.player,
    mask: Layers.terrain | Layers.enemy
  })

  // Détection du sol via raycast
  const groundRay = useRaycast({
    origin: () => ({ x: pos.x, y: pos.y - 0.9, z: pos.z }),
    direction: { x: 0, y: -1, z: 0 },
    maxDist: 0.1,
    mask: Layers.terrain
  })

  let grounded = false
  let moveSpeed = 0

  onUpdate(({ input, dt }) => {
    // Vérification du sol
    grounded = groundRay.hit

    // Obtenir l'entrée de mouvement
    const forward = input.axis('forward') ?? 0  // W/S ou Flèche haut/bas
    const right = input.axis('right') ?? 0      // A/D ou Flèche gauche/droite

    // Appliquer le mouvement
    const targetSpeed = 10
    moveSpeed = forward * targetSpeed

    const vel = body.velocity
    body.setVelocity(right * 5, vel.y, moveSpeed)

    // Saut
    if (input.justPressed('Space') && grounded) {
      body.applyImpulse(0, 10, 0)  // Impulsion de saut en Y
    }
  })
})
```

### Colliders de mesh avec BVH

Pour un terrain complexe, utilisez un BVH pré-balisé pour l'efficacité :

```ts
// Dans la configuration de compilation (plugin Vite) :
// vite.config.ts
import { physicsPlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    physicsPlugin({
      bvhPreload: ['./models/terrain.glb', './models/level-geometry.glb']
    })
  ]
})

// Dans l'acteur :
const TerrainActor = defineActor('Terrain', () => {
  useStaticBody()
  
  // Le plugin Vite convertit ceci en un handle préchargé
  const meshHandle = useMeshCollider('./models/terrain.glb')
  
  // Suivi du chargement
  meshHandle.ready.then(() => {
    console.log('Terrain collider loaded and active')
  }).catch(() => {
    console.error('Failed to load terrain collider')
  })
})
```

## Sous le capot

### Options du corps

**Corps dynamique :**
- `mass?: number` — Masse en kg (défaut: 1)
- `gravityScale?: number` — Multiplicateur de gravité (défaut: 1)
- `linearDamping?: number` — Amortissement de la vélocité (défaut: 0.1)
- `angularDamping?: number` — Amortissement de la rotation (défaut: 0.1)
- `ccdEnabled?: boolean` — Détection de collision continue (défaut: false)
- `fixedRotation?: boolean` — Verrouiller la rotation (défaut: false)
- `initialPosition?: Vec3` — Position initiale
- `initialRotation?: Quat` — Rotation initiale (quaternion)
- `initialLinearVelocity?: Vec3` — Vélocité initiale
- `initialAngularVelocity?: Vec3` — Vélocité angulaire initiale
- `quality?: 'fast' | 'medium' | 'high'` — Qualité du solveur (défaut: 'medium')

**Corps cinématique :**
- `initialPosition?: Vec3`
- `initialRotation?: Quat`

### Application des forces

Les corps dynamiques ont plusieurs façons d'appliquer des forces :

```ts
const body = useDynamicBody()

// Définir la vélocité directement (m/s)
body.setVelocity(5, 0, 0)

// Appliquer une impulsion (N·s) — changement de vélocité instantané
body.applyImpulse(0, 10, 0)

// Appliquer une force (N) — continue
body.applyForce(0, 20, 0)

// Appliquer un couple (N·m) — force rotationnelle
body.applyTorque(1, 0, 0)

// Vélocité actuelle et vélocité angulaire
const vel = body.velocity
const angVel = body.angularVelocity
```

### Préchargement des colliders de mesh

Pour les grands colliders de mesh, préchargez le BVH pour éviter les saccades pendant le jeu :

```ts
import { preloadMeshCollider } from '@gwenjs/physics3d'

// Lors de l'initialisation de l'application :
const terrainBvh = await preloadMeshCollider('./models/terrain.glb')

// Plus tard, dans un acteur :
const TerrainActor = defineActor('Terrain', () => {
  useStaticBody()
  useMeshCollider(terrainBvh)  // Pas d'attente asynchrone nécessaire
})
```

## Résumé de l'API

### Composables

| Fonction | Retours | Objectif |
|---|---|---|
| `useStaticBody()` | `void` | Corps statique (immobile). |
| `useDynamicBody(opts?)` | `DynamicBodyHandle3D` | Corps entièrement simulé. |
| `useKinematicBody(opts?)` | `KinematicBodyHandle3D` | Corps piloté manuellement. |
| `useBoxCollider(opts)` | `BoxColliderHandle3D` | Collider en forme de boîte. |
| `useSphereCollider(opts)` | `SphereColliderHandle3D` | Collider de sphère. |
| `useCapsuleCollider(opts)` | `CapsuleColliderHandle3D` | Collider en capsule. |
| `useConvexCollider(opts)` | `ConvexColliderHandle3D` | Collider enveloppe convexe. |
| `useCompoundCollider(opts)` | `CompoundColliderHandle3D` | Plusieurs formes combinées. |
| `useMeshCollider(opts)` | `MeshColliderHandle3D` | Collider de mesh triangulaire. |
| `useHeightfieldCollider(opts)` | `HeightfieldColliderHandle3D` | Collider heightfield. |
| `useRaycast(opts)` | `UseRaycastHandle` | Requête raycast par image. |
| `useShapeCast(opts)` | `UseShapeCastHandle` | Balayage de forme par image. |
| `useOverlap(opts)` | `UseOverlapHandle` | Vérification de chevauchement par image. |
| `useJoint(opts)` | `UseJointHandle` | Articulation de contrainte physique. |
| `defineLayers(def)` | `Record<string, number>` | Couches de collision nommées. |

### Gestionnaires d'événements

| Fonction | Signature du callback | Objectif |
|---|---|---|
| `onContact(callback)` | `(contact: ContactEvent3D) => void` | Événement de collision. |
| `onSensorEnter(sensorId, cb)` | `(entityId: bigint) => void` | Entrée de capteur. |
| `onSensorExit(sensorId, cb)` | `(entityId: bigint) => void` | Sortie de capteur. |

### Méthodes du handle de corps

**DynamicBodyHandle3D :**
- `get velocity(): Vec3` — Vélocité linéaire actuelle.
- `get angularVelocity(): Vec3` — Vélocité angulaire actuelle.
- `setVelocity(vx, vy, vz): void` — Définir la vélocité.
- `applyForce(fx, fy, fz): void` — Appliquer une force continue.
- `applyImpulse(ix, iy, iz): void` — Appliquer une impulsion instantanée.
- `applyTorque(tx, ty, tz): void` — Appliquer une force rotationnelle.
- `enable(): void` — Réactiver si désactivé.
- `disable(): void` — Supprimer de la simulation.
- `get active(): boolean` — Si le corps est actif.
- `get bodyId(): number` — Identifiant unique.

**KinematicBodyHandle3D :** Similaire, mais sans les méthodes force/impulsion/torque.

### Types

- `Vec3` — `{ x: number, y: number, z: number }`
- `ContactEvent3D` — `{ other: bigint, relativeVelocity: number, point: Vec3, normal: Vec3 }`
- Diverses handles de collider avec `colliderId`, `isSensor`, `remove()`, etc.
- `UseRaycastHandle` — Propriétés de hit et `dispose()`
- `UseShapeCastHandle` — Similaire au raycast
- `UseOverlapHandle` — `entities: bigint[]`
- `UseJointHandle` — `remove(): void`
