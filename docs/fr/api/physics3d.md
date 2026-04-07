---
title: "@gwenjs/physics3d"
description: "Référence API pour @gwenjs/physics3d."
---

# @gwenjs/physics3d

`pnpm add @gwenjs/physics3d`

Module de moteur physique 3D propulsé par Rapier3D. Fournit la dynamique des corps rigides, la détection de collisions, les événements de capteur, le filtrage par calques et les colliders de maillage accélérés par BVH.

## Configuration du module

Enregistrez le module dans `gwen.config.ts` :

```ts
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics3d', {
      gravity: { x: 0, y: -9.81, z: 0 },
      maxEntities: 10_000,
      qualityPreset: 'medium',
      debug: false,
      coalesceEvents: true,
      layers: ['default', 'player', 'enemy'],
      vite: {
        bvhPrebake: false,
        debug: false,
      },
    }],
  ],
})
```

### Physics3DConfig

| Champ | Type | Défaut | Description |
|---|---|---|---|
| `gravity` | `Partial<Physics3DVec3>` | `{ x: 0, y: -9.81, z: 0 }` | Vecteur de gravité du monde |
| `maxEntities` | `number` | `10_000` | Nombre maximum d'entités physiques |
| `qualityPreset` | `Physics3DQualityPreset` | `'medium'` | Qualité du solveur : `'low'`, `'medium'`, `'high'` ou `'esport'` |
| `debug` | `boolean` | `false` | Active les journaux de débogage physique à l'exécution |
| `coalesceEvents` | `boolean` | `true` | Fusionne les événements de contact dupliqués dans une frame |
| `layers` | `string[]` | `['default']` | Liste de calques de collision nommés (max 32) |
| `vite` | `object` | — | Options du plugin Vite au moment du build (voir ci-dessous) |
| `vite.bvhPrebake` | `boolean` | `false` | Pré-compile le BVH pour `useMeshCollider('./x.glb')` au moment du build |
| `vite.debug` | `boolean` | `false` | Active la journalisation du plugin Vite |

## Composables

Tous les composables sont importés depuis `@gwenjs/physics3d` et doivent être appelés à l'intérieur de `defineActor`.

### Corps

#### useDynamicBody(options?)

```ts
function useDynamicBody(options?: Physics3DBodyOptions): DynamicBodyHandle
```

Ajoute un corps rigide dynamique affecté par la gravité et les forces.

**Retourne :** `DynamicBodyHandle`

```ts
import { useDynamicBody, useSphereCollider } from '@gwenjs/physics3d'

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 5, restitution: 0.6 })
  useSphereCollider({ radius: 1 })
})
```

#### useStaticBody(options?)

```ts
function useStaticBody(options?: Physics3DBodyOptions): void
```

Ajoute un corps statique (immobile). À utiliser pour le terrain et les obstacles fixes. Retourne `void`.

```ts
import { useStaticBody, useMeshCollider } from '@gwenjs/physics3d'

export const TerrainActor = defineActor(TerrainPrefab, () => {
  useStaticBody()
  useMeshCollider('./terrain.glb')
})
```

#### useKinematicBody(options?)

```ts
function useKinematicBody(options?: Physics3DBodyOptions): KinematicBodyHandle
```

Ajoute un corps cinématique contrôlé par la vélocité, non affecté par la gravité.

**Retourne :** `KinematicBodyHandle`

```ts
import { useKinematicBody, useCapsuleCollider } from '@gwenjs/physics3d'

export const PlayerActor = defineActor(PlayerPrefab, () => {
  const body = useKinematicBody()
  useCapsuleCollider({ radius: 0.4, halfHeight: 0.9 })
})
```

### Colliders

#### useBoxCollider(options)

```ts
function useBoxCollider(options: {
  extents: Physics3DVec3
  sensor?: boolean
  density?: number
}): void
```

Ajoute un collider de boîte avec les demi-extensions données.

| Paramètre | Type | Description |
|---|---|---|
| `options.extents` | `Physics3DVec3` | Demi-taille sur chaque axe |
| `options.sensor` | `boolean` | Déclencheur uniquement (sans réponse physique) |
| `options.density` | `number` | Densité du collider |

```ts
useBoxCollider({ extents: { x: 1, y: 2, z: 1 } })
```

#### useSphereCollider(options)

```ts
function useSphereCollider(options: {
  radius: number
  sensor?: boolean
  density?: number
}): void
```

Ajoute un collider de sphère.

```ts
useSphereCollider({ radius: 0.5 })
```

#### useCapsuleCollider(options)

```ts
function useCapsuleCollider(options: {
  radius: number
  halfHeight: number
  sensor?: boolean
  density?: number
}): void
```

Ajoute un collider de capsule (cylindre coiffé d'hémisphères). Couramment utilisé pour les corps de personnages.

```ts
useCapsuleCollider({ radius: 0.4, halfHeight: 0.9 })
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

#### useConvexCollider(path | options)

```ts
function useConvexCollider(source: string | {
  vertices: Float32Array
  sensor?: boolean
  density?: number
}): void
```

Ajoute un collider d'enveloppe convexe. Plus rapide que le trimesh ; adapté aux corps dynamiques.

```ts
useConvexCollider('./rock.glb')
```

### Événements

Tous les composables d'événements sont automatiquement nettoyés à la destruction de l'acteur.

#### onContact(handler)

```ts
function onContact(handler: (event: ContactEvent3D) => void): void
```

Enregistre un gestionnaire appelé lorsque le collider de cet acteur entre ou sort de contact avec un autre.

```ts
import { onContact } from '@gwenjs/physics3d'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  onContact((event) => {
    if (event.started) {
      console.log('Hit by entity', event.otherId)
    }
  })
})
```

#### onSensorEnter(handler)

```ts
function onSensorEnter(handler: (otherId: number) => void): void
```

Appelé lorsqu'un autre collider entre dans le collider capteur de cet acteur.

```ts
import { useBoxCollider, onSensorEnter } from '@gwenjs/physics3d'

export const TriggerZone = defineActor(TriggerPrefab, () => {
  useBoxCollider({ extents: { x: 3, y: 1, z: 3 }, sensor: true })
  onSensorEnter((otherId) => {
    console.log('Entity entered zone:', otherId)
  })
})
```

#### onSensorExit(handler)

```ts
function onSensorExit(handler: (otherId: number) => void): void
```

Appelé lorsqu'un autre collider quitte le collider capteur de cet acteur.

### Calques

#### defineLayers(layerList)

```ts
function defineLayers(layerList: string[]): Record<string, number>
```

Convertit une liste de calques nommés (correspondant à celle dans `gwen.config.ts`) en un objet de masques de bits. Le plugin Vite intègre ces valeurs littérales au moment du build.

```ts
import { defineLayers } from '@gwenjs/physics3d'

const Layers = defineLayers(['default', 'player', 'enemy'])
// Layers.default === 1, Layers.player === 2, Layers.enemy === 4

useBoxCollider({
  extents: { x: 1, y: 1, z: 1 },
  // les appartenances et filtres utilisent des valeurs de masque de bits
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
| `applyImpulse` | `(entity: number, impulse: Physics3DVec3) => void` | Applique une impulsion instantanée |
| `applyForce` | `(entity: number, force: Physics3DVec3) => void` | Applique une force continue cette frame |
| `applyTorque` | `(entity: number, torque: Physics3DVec3) => void` | Applique une force rotationnelle |
| `setVelocity` | `(entity: number, velocity: Physics3DVec3) => void` | Remplace la vélocité linéaire |
| `getVelocity` | `(entity: number) => Physics3DVec3` | Lit la vélocité linéaire actuelle |
| `setAngularVelocity` | `(entity: number, av: Physics3DVec3) => void` | Remplace la vélocité angulaire |
| `getAngularVelocity` | `(entity: number) => Physics3DVec3` | Lit la vélocité angulaire actuelle |
| `raycast` | `(from: Physics3DVec3, direction: Physics3DVec3, options?: RaycastOptions) => RaycastHit[]` | Lance un rayon et retourne les impacts |
| `setGravity` | `(gravity: Physics3DVec3) => void` | Modifie la gravité du monde à l'exécution |
| `getGravity` | `() => Physics3DVec3` | Lit la gravité du monde actuelle |

```ts
const physics = usePhysics3D()

// Saut
physics.applyImpulse(entityId, { x: 0, y: 300, z: 0 })

// Vérification du sol
const hits = physics.raycast(
  { x: 0, y: 1, z: 0 },
  { x: 0, y: -1, z: 0 },
  { maxDistance: 1.1 }
)
const isGrounded = hits.length > 0
```

## Intégration Vite

### physics3dVitePlugin(options?)

```ts
function physics3dVitePlugin(options?: GwenPhysics3DPluginOptions): VitePlugin
```

Plugin Vite au moment du build. Il est **enregistré automatiquement** par le module `@gwenjs/physics3d` — aucune inscription manuelle n'est nécessaire dans la plupart des projets. Configurez-le via la clé `vite` dans les options du module.

```ts
interface GwenPhysics3DPluginOptions {
  debug?: boolean      // défaut : false — active la journalisation du plugin Vite
  bvhPrebake?: boolean // défaut : false — pré-compile le BVH pour les chemins de collider de maillage
}
```

Le plugin effectue deux transformations au moment du build :

1. **Intégration des calques** — remplace `Layers.player` par sa valeur de masque de bits littérale. Élimine la résolution à l'exécution et permet l'élimination du code mort.
2. **Pré-calcul BVH** (opt-in) — détecte les occurrences de `useMeshCollider('./terrain.glb')`, compile le BVH au moment du build et remplace le chemin par `{ __bvhUrl: 'bvh-<hash>.bin' }`.

:::tip Avertissement pour les calques non utilisés
Lorsque l'intégration des calques est active, le plugin Vite émet un avertissement de build pour tout calque défini dans la configuration mais jamais référencé dans le code source. Utilisez ceci pour maintenir votre liste de calques propre.
:::

:::tip Flux de travail BVH pre-bake
Activez `bvhPrebake: true` (via `vite.bvhPrebake` dans la configuration du module) pour les grands maillages de terrain. Le BVH est compilé une seule fois au moment du build et servi sous forme d'asset binaire, de sorte que l'initialisation du raycast à l'exécution est quasi instantanée — sans coût de reconstruction BVH par frame.
:::

:::warning Déprécié
`createGwenPhysics3DPlugin()` est déprécié. Remplacez par `physics3dVitePlugin({ bvhPrebake: true })` si vous avez besoin d'enregistrer le plugin Vite manuellement.
:::

## Définitions de type

### Physics3DConfig

```ts
interface Physics3DConfig {
  gravity: Partial<Physics3DVec3>
  maxEntities: number
  qualityPreset: 'low' | 'medium' | 'high' | 'esport'
  debug: boolean
  coalesceEvents: boolean
  layers: string[]
  vite: {
    bvhPrebake: boolean
    debug: boolean
  }
}
```

### Physics3DVec3

```ts
interface Physics3DVec3 {
  x: number
  y: number
  z: number
}
```

### Physics3DQuat

```ts
interface Physics3DQuat {
  x: number
  y: number
  z: number
  w: number
}
```

### Physics3DQualityPreset

```ts
type Physics3DQualityPreset = 'low' | 'medium' | 'high' | 'esport'
```
