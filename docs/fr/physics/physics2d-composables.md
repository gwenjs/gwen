---
title: Composables Physics 2D
description: API centré sur les composables pour la physique de corps rigides 2D dans GWEN avec Rapier2D.
---

# Composables Physics 2D

**Package:** `@gwenjs/physics2d`

Les composables physiques sont des fonctions composables appelées à l'intérieur de `defineActor()` qui ajoutent la dynamique des corps rigides et les collisions aux acteurs. Ils fonctionnent en parfaite harmonie avec le graphe de scène — chaque acteur obtient son propre corps physique, et les événements comme les collisions sont envoyés par entité.

## Configuration du module

Toutes les options sont passées comme second élément du tuple de module dans `gwen.config.ts` :

```typescript
// gwen.config.ts
export default defineConfig({
  modules: [
    ['@gwenjs/physics2d', {
      gravity: -9.81,
      qualityPreset: 'medium',
    }]
  ],
})
```

| Option | Type | Défaut | Description |
|---|---|---|---|
| `gravity` | `number` | `-9.81` | Gravité verticale (axe Y, m/s²) |
| `gravityX` | `number` | `0` | Gravité horizontale (axe X, m/s²) |
| `maxEntities` | `number` | `10_000` | Nombre max d'entités physiques |
| `qualityPreset` | `'low' \| 'medium' \| 'high' \| 'esport'` | `'medium'` | Préréglage de qualité physique |
| `eventMode` | `'pull' \| 'hybrid'` | `'pull'` | Mode de lecture des événements de collision |
| `coalesceEvents` | `boolean` | `true` | Fusionner les événements de collision dupliqués |
| `ccdEnabled` | `boolean` | auto | Détection de collision continue (activée automatiquement à `'high'`/`'esport'`) |
| `layers` | `Record<string, number>` | `{}` | Couches de collision (index de bit 0–31) |
| `debug` | `boolean` | `false` | Activer le renderer de débogage |

### Couches de collision

```typescript
export default defineConfig({
  modules: [
    ['@gwenjs/physics2d', {
      layers: {
        player:  0,
        enemy:   1,
        terrain: 2,
        sensor:  3,
      }
    }]
  ],
})
```

Utilisez `defineLayers()` dans un système ou un acteur pour construire des filtres en bitmask :

```typescript
const layers = defineLayers({ player: 0, enemy: 1, terrain: 2 })
// layers.player === 0b001, layers.enemy === 0b010, etc.
```

## Les bases

Déclarez la physique à l'intérieur de `defineActor()` — une fois par type d'acteur. Les composables lisent le contexte de l'acteur automatiquement.

```ts
import { defineActor, onUpdate } from '@gwenjs/core'
import { useShape, useDynamicBody, useBoxCollider, onContact } from '@gwenjs/physics2d'

export const PlayerActor = defineActor('Player', () => {
  useShape({ w: 32, h: 48 })
  useDynamicBody({ gravityScale: 1 })
  useBoxCollider({ w: 32, h: 48 })

  onContact((contact) => {
    if (contact.relativeVelocity > 50) {
      console.log('Hit something hard!')
    }
  })

  onUpdate(() => {
    // Update player logic each frame
  })
})
```

Le plugin fait automatiquement :
- Enregistre le corps avec la simulation physique
- Synchronise les formes de collider avec le corps
- Envoie les événements de collision aux callbacks abonnés
- Nettoie quand l'acteur disparaît

## Corps

Chaque acteur a besoin d'exactement un composable de corps. Choisissez selon la façon dont le corps doit se déplacer :

| Composable | Cas d'usage |
|---|---|
| `useDynamicBody(opts?)` | Entièrement simulé : affecté par la gravité, les forces et les collisions. À utiliser pour les personnages, les objets, les projectiles. |
| `useKinematicBody(opts?)` | Piloté manuellement : se déplace sur commande, pousse les corps dynamiques. À utiliser pour les plateformes, les ascenseurs, les portes coulissantes. |
| `useStaticBody()` | Ne bouge jamais : ancré dans l'espace. À utiliser pour le terrain, les murs, les obstacles immobiles. |

```ts
// Caisse en chute libre entièrement simulée
const CrateActor = defineActor('Crate', () => {
  useDynamicBody({ mass: 5, linearDamping: 0.1 })
  useBoxCollider({ w: 32, h: 32 })
})

// Plateforme qui se déplace sur commande
const PlatformActor = defineActor('Platform', () => {
  const body = useKinematicBody()
  useBoxCollider({ w: 128, h: 16 })
  onUpdate(({ dt }) => {
    body.setVelocity(50, 0) // Se déplacer vers la droite à vitesse constante
  })
})

// Sol immobile
const GroundActor = defineActor('Ground', () => {
  useStaticBody()
  useBoxCollider({ w: 1024, h: 32 })
})
```

## Colliders

Ajoutez des formes de collision à un corps avec un composable collider. Un acteur peut avoir plusieurs colliders pour des formes complexes.

| Composable | Forme |
|---|---|
| `useBoxCollider(opts)` | Rectangle aligné sur les axes. Parfait pour les personnages, les caisses, les plateformes. |
| `useCapsuleCollider(opts)` | Capsule (rectangle arrondi). Idéal pour les collisions de personnages lisses. |
| `useSphereCollider(opts)` | Cercle. Parfait pour les balles, les explosions, les obstacles ronds. |

```ts
// Personnage avec collider en capsule
const CharacterActor = defineActor('Character', () => {
  useDynamicBody({ mass: 1, gravityScale: 1 })
  useCapsuleCollider({ radius: 0.5, length: 2 })
})

// Balle avec collider capteur (chevauchement uniquement)
const BallActor = defineActor('Ball', () => {
  useDynamicBody({ mass: 0.5 })
  useSphereCollider({ radius: 0.25, isSensor: true })
})
```

### Options des colliders

**Tous les colliders acceptent :**
- `offsetX?: number` — Décalage X local par rapport à l'origine de l'acteur (défaut: 0)
- `offsetY?: number` — Décalage Y local par rapport à l'origine de l'acteur (défaut: 0)
- `isSensor?: boolean` — Génère des événements de chevauchement sans réponse physique (défaut: false)
- `layer?: number` — Masque de couche d'appartenance (voir Couches de collision ci-dessous)
- `mask?: number` — Masque de filtre de collision (voir Couches de collision ci-dessous)

**Collider de boîte :**
- `w: number` — Largeur en unités du monde
- `h: number` — Hauteur en unités du monde

**Collider en capsule :**
- `radius: number` — Rayon en unités du monde
- `length: number` — Longueur (hauteur) en unités du monde

**Collider de sphère :**
- `radius: number` — Rayon en unités du monde

## Événements

### Événements de contact

Abonnez-vous aux événements de contact de collision avec `onContact()` :

```ts
onContact((contact) => {
  console.log('Entity collided:', contact.other)
  console.log('Relative velocity:', contact.relativeVelocity)
  console.log('Normal:', contact.normal)
})
```

L'objet `contact` a :
- `other` — ID de l'entité qui entre en collision
- `relativeVelocity` — Vitesse à laquelle les deux corps entrent en collision
- `normal` — Vecteur normal de la surface de collision

### Événements des capteurs

Pour les capteurs (colliders avec `isSensor: true`), utilisez `onSensorEnter` et `onSensorExit` :

```ts
const damageZone = useBoxCollider({ w: 64, h: 64, isSensor: true })

onSensorEnter(damageZone.colliderId, (entityId) => {
  console.log('Entity entered damage zone:', entityId)
})

onSensorExit(damageZone.colliderId, (entityId) => {
  console.log('Entity left damage zone:', entityId)
})
```

## Couches de collision

Utilisez les couches pour activer/désactiver sélectivement les collisions entre les types d'objets :

```ts
import { defineLayers } from '@gwenjs/physics2d'

export const Layers = defineLayers({
  player:   1 << 0,  // bit 0
  enemy:    1 << 1,  // bit 1
  terrain:  1 << 2,  // bit 2
  projectile: 1 << 3, // bit 3
})

// Le joueur entre en collision avec le terrain uniquement (pas les ennemis)
const PlayerActor = defineActor('Player', () => {
  useDynamicBody()
  useBoxCollider({
    w: 32, h: 48,
    layer: Layers.player,
    mask: Layers.terrain  // Entre en collision uniquement avec le terrain
  })
})

// L'ennemi entre en collision avec le terrain et les projectiles (pas le joueur)
const EnemyActor = defineActor('Enemy', () => {
  useDynamicBody()
  useBoxCollider({
    w: 24, h: 24,
    layer: Layers.enemy,
    mask: Layers.terrain | Layers.projectile
  })
})

// Le projectile entre en collision avec tout sauf les autres projectiles
const ProjectileActor = defineActor('Projectile', () => {
  useDynamicBody()
  useSphereCollider({
    radius: 4,
    layer: Layers.projectile,
    mask: Layers.player | Layers.enemy | Layers.terrain
  })
})
```

## En pratique

### Personnage de plateforme

Voici un motif courant : un personnage qui tombe avec la gravité, entre en collision avec le terrain et peut sauter en touchant le sol.

```ts
import { defineActor, onUpdate, createEntity } from '@gwenjs/core'
import { useDynamicBody, useCapsuleCollider, onContact } from '@gwenjs/physics2d'

export const PlayerActor = defineActor('Player', () => {
  const body = useDynamicBody({
    mass: 1,
    gravityScale: 3,
    linearDamping: 0.2
  })

  useCapsuleCollider({
    radius: 0.4,
    length: 1.8,
    layer: Layers.player,
    mask: Layers.terrain
  })

  let grounded = false

  onContact((contact) => {
    // Détection simple du sol : toute collision compte comme au sol
    // (En production, vérifiez la normale de collision pour une meilleure précision)
    grounded = true
  })

  onUpdate(({ input }) => {
    // Mouvement
    if (input.pressed('ArrowLeft')) {
      body.setVelocity(-8, body.velocity.y)
    } else if (input.pressed('ArrowRight')) {
      body.setVelocity(8, body.velocity.y)
    }

    // Saut
    if (input.justPressed('Space') && grounded) {
      body.applyImpulse(0, 500)
      grounded = false
    }
  })
})
```

## Sous le capot

### Options du corps

**Options du corps dynamique :**
- `mass?: number` — Masse en kg (défaut: 1)
- `gravityScale?: number` — Multiplicateur de gravité (défaut: 1)
- `linearDamping?: number` — Amortissement de la vélocité linéaire (défaut: 0.1)
- `angularDamping?: number` — Amortissement de la vélocité angulaire (défaut: 0.1)
- `fixedRotation?: boolean` — Empêcher la rotation (attention: pas encore pris en charge)

**Options du corps cinématique :**
- `layer?: number` — Couche d'appartenance (pour les interactions avec les corps dynamiques)
- `mask?: number` — Masque de filtre de collision

**Les corps statiques** n'acceptent aucune option — ils ont une masse infinie et ne bougent jamais.

### Application des forces

Pour les corps dynamiques, utilisez le handle retourné par `useDynamicBody` :

```ts
const body = useDynamicBody()

// Définir la vélocité directement (m/s)
body.setVelocity(10, 0)

// Appliquer une impulsion instantanée (N·s)
body.applyImpulse(0, 500)

// Remarque: applyForce est une non-opération dans Rapier2D; utilisez les impulsions à la place
body.applyForce(0, 100)  // Cela n'a aucun effet
```

### Composable de forme

Le composable `useShape()` définit les dimensions partagées que d'autres systèmes peuvent lire :

```ts
useShape({ w: 32, h: 48 })
```

Les renderers et autres composables peuvent lire ces dimensions sans dupliquer les données :

```ts
// Plus tard, un renderer de sprite peut utiliser les mêmes dimensions
useSprite({ texture: 'player', width: 32, height: 48 })
```

### Activation et désactivation des corps

Basculez la physique on/off au moment de l'exécution :

```ts
const body = useDynamicBody()

onUpdate(() => {
  if (someCondition) {
    body.disable()  // Supprime de la simulation physique
  } else {
    body.enable()   // Réenregistre avec la physique
  }
})
```

## Résumé de l'API

### Composables

| Fonction | Retours | Objectif |
|---|---|---|
| `useStaticBody()` | `void` | Enregistre un corps physique statique (immobile). |
| `useDynamicBody(opts?)` | `DynamicBodyHandle` | Enregistre un corps physique entièrement simulé. |
| `useKinematicBody(opts?)` | `KinematicBodyHandle` | Enregistre un corps physique cinématique (piloté manuellement). |
| `useBoxCollider(opts)` | `BoxColliderHandle` | Attache un collider en forme de boîte. |
| `useCapsuleCollider(opts)` | `CapsuleColliderHandle` | Attache un collider en forme de capsule. |
| `useSphereCollider(opts)` | `SphereColliderHandle` | Attache un collider en forme de sphère. |
| `useShape(opts)` | `void` | Définit les dimensions de forme partagées pour l'acteur. |
| `defineLayers(def)` | `Record<string, number>` | Déclare des couches de collision nommées avec des valeurs de masque de bits. |

### Gestionnaires d'événements

| Fonction | Signature du callback | Objectif |
|---|---|---|
| `onContact(callback)` | `(contact: ContactEvent) => void` | Se déclenche lorsque cette entité entre en collision avec une autre. |
| `onSensorEnter(sensorId, callback)` | `(entityId: bigint) => void` | Se déclenche lorsqu'une entité entre dans un collider capteur. |
| `onSensorExit(sensorId, callback)` | `(entityId: bigint) => void` | Se déclenche lorsqu'une entité quitte un collider capteur. |

### Méthodes du handle de corps

**DynamicBodyHandle :**
- `get velocity(): { x: number, y: number }` — Vélocité linéaire actuelle.
- `setVelocity(vx: number, vy: number): void` — Définir la vélocité directement.
- `applyImpulse(ix: number, iy: number): void` — Appliquer une impulsion instantanée.
- `applyForce(fx: number, fy: number): void` — Non-opération dans Rapier2D; utilisez l'impulsion.
- `enable(): void` — Réactiver le corps s'il est désactivé.
- `disable(): void` — Supprimer le corps de la simulation.
- `get active(): boolean` — Si le corps est actuellement dans la simulation.
- `get bodyId(): number` — Identifiant unique du corps.

**KinematicBodyHandle :** Similaire à `DynamicBodyHandle`, mais sans les méthodes d'impulsion/force.

### Types

- `ContactEvent` — `{ other: bigint, relativeVelocity: number, normal: { x: number, y: number } }`
- `BoxColliderHandle` — `{ colliderId: number, isSensor: boolean }`
- `CapsuleColliderHandle` — `{ colliderId: number, isSensor: boolean }`
- `SphereColliderHandle` — `{ colliderId: number, isSensor: boolean }`

## Helpers Physics

Fonctions helper tree-shakables pour les opérations physiques courantes. N'importez que ce dont vous avez besoin.

> Tous les helpers requièrent une instance `physics: Physics2DAPI` comme premier argument. Obtenez-la via `api.services.get('physics')` dans un système, ou `usePhysics2D()` dans un composable.

### Mouvement

```typescript
import { moveKinematicByVelocity, applyDirectionalImpulse } from '@gwenjs/physics2d/helpers/movement'

// Déplacer un corps cinématique par vecteur de vélocité mis à l'échelle par dt
moveKinematicByVelocity(physics, entityId, { x: vx, y: vy }, dt)

// Appliquer une impulsion dans une direction (pour les projectiles, les explosions)
applyDirectionalImpulse(physics, entityId, { x: 0, y: 1 }, force)
```

### Requêtes

```typescript
import { getBodySnapshot, getSpeed, isSensorActive } from '@gwenjs/physics2d/helpers/queries'

// Obtenir un snapshot de l'état physique d'un corps
const snap = getBodySnapshot(physics, entityId)
// snap: PhysicsEntitySnapshot { entityId, position, velocity }

// Obtenir la vitesse scalaire (magnitude de la vélocité)
const speed = getSpeed(physics, entityId)  // number

// Vérifier si un capteur est actuellement actif pour une entité
const active = isSensorActive(physics, entityId, sensorId)  // boolean
```

### Orchestration de chunks de tilemap

```typescript
import { createTilemapChunkOrchestrator } from '@gwenjs/physics2d/helpers/orchestration'

const orchestrator = createTilemapChunkOrchestrator(physics, {
  source: tilemapInput,
})
// TilemapChunkOrchestrator — charger/décharger les colliders statiques par chunk visible
// Méthodes : syncVisibleChunks(chunks), patchChunk(cx, cy, source), dispose()
```
