---
title: "@gwenjs/physics2d"
description: "Référence API pour @gwenjs/physics2d."
---

# @gwenjs/physics2d

`pnpm add @gwenjs/physics2d`

Plugin de moteur de physique 2D alimenté par Rapier2D. Fournit la dynamique des corps rigides, les colliders et les capteurs pour les jeux 2D.

## Configuration du plugin

### Physics2DPlugin()

**Signature:**
```ts
function Physics2DPlugin(options?: Physics2DPluginOptions): PluginDef
```

**Description.** Crée le plugin de physique 2D. Enregistrez dans votre config d'app pour activer la simulation physique.

**Retourne:** `PluginDef` — définition du plugin de physique.

**Exemple:**
```ts
export default defineConfig({
  plugins: [Physics2DPlugin()],
  // ...
});
```

## Composables

Utilisez ceux-ci à l'intérieur de `defineActor` pour ajouter des composants de physique aux entités.

### useShape(options)

**Signature:**
```ts
function useShape(options: ShapeOptions): void
```

**Description.** Ajoute une forme (collider) à l'entité courante.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `ShapeOptions` | Configuration de la forme |

**Retourne:** `void`

### useDynamicBody(options?)

**Signature:**
```ts
function useDynamicBody(options?: DynamicBodyOptions): void
```

**Description.** Ajoute un corps rigide dynamique (affecté par la gravité et les forces). À utiliser pour les objets de jeu en mouvement.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `DynamicBodyOptions` | Configuration du corps (optionnel) |

**Retourne:** `void`

**Exemple:**
```ts
const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const BallActor = defineActor(BallPrefab, () => {
  useDynamicBody({ mass: 2, restitution: 0.8 })
  useBoxCollider({ w: 1, h: 1 })
})
```

### useKinematicBody(options?)

**Signature:**
```ts
function useKinematicBody(options?: KinematicBodyOptions): void
```

**Description.** Ajoute un corps cinématique (non affecté par la gravité, contrôlé par la vélocité). À utiliser pour les plates-formes, les obstacles mobiles.

**Retourne:** `void`

### useStaticBody()

**Signature:**
```ts
function useStaticBody(): void
```

**Description.** Ajoute un corps statique (immobile). À utiliser pour le terrain, les murs, le sol.

**Retourne:** `void`

**Exemple:**
```ts
const GroundPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const GroundActor = defineActor(GroundPrefab, () => {
  useStaticBody()
  useBoxCollider({ w: 100, h: 1 })
})
```

## Colliders

### useBoxCollider(options)

**Signature:**
```ts
function useBoxCollider(options: BoxColliderOptions): void
```

**Description.** Ajoute un collider de boîte/rectangle à l'entité courante.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.w | `number` | Largeur de la boîte en unités monde |
| options.h | `number` | Hauteur de la boîte en unités monde |
| options.isSensor | `boolean` | Si vrai, génère des événements de chevauchement sans réponse physique |
| options.layer | `number` | Bitmask de couche d'appartenance aux collisions |
| options.mask | `number` | Bitmask de filtre de collision |
| options.offsetX | `number` | Décalage X local par rapport à l'origine de l'acteur |
| options.offsetY | `number` | Décalage Y local par rapport à l'origine de l'acteur |

**Retourne:** `BoxColliderHandle`

**Exemple:**
```ts
useBoxCollider({ w: 2, h: 2, isSensor: false });
```

### useSphereCollider(options)

**Signature:**
```ts
function useSphereCollider(options: SphereColliderOptions): void
```

**Description.** Ajoute un collider circulaire à l'entité courante.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.radius | `number` | Rayon du cercle en unités monde |
| options.isSensor | `boolean` | Si vrai, génère des événements de chevauchement sans réponse physique |
| options.layer | `number` | Bitmask de couche d'appartenance aux collisions |
| options.mask | `number` | Bitmask de filtre de collision |

**Retourne:** `void`

### useCapsuleCollider(options)

**Signature:**
```ts
function useCapsuleCollider(options: CapsuleColliderOptions): void
```

**Description.** Ajoute un collider de capsule (rectangle arrondi).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.radius | `number` | Rayon de la capsule en unités monde |
| options.height | `number` | Hauteur totale de la capsule en unités monde |
| options.isSensor | `boolean` | Si vrai, génère des événements de chevauchement sans réponse physique |
| options.layer | `number` | Bitmask de couche d'appartenance aux collisions |
| options.mask | `number` | Bitmask de filtre de collision |

**Retourne:** `void`

## Événements

### physics2d:body-disabled

Le plugin émet ce hook après un pas qui a désactivé un corps. La charge est `{ entity, reason }`. `reason` vaut `non-finite`, `out-of-bounds` ou `velocity`. Le corps reste enregistré. Une requête ou `getPosition` répond encore. Un corps dynamique et un corps mis en quarantaine par Rapier sont tous les deux inclus (`crates/gwen-core/src/physics2d/world.rs:972`).

```ts
engine.hooks.hook("physics2d:body-disabled", ({ entity, reason }) => {
  // reason vaut "non-finite", "out-of-bounds" ou "velocity"
  void entity;
  void reason;
});
```

`non-finite` signifie qu'une translation ou une vitesse linéaire dynamique n'est pas finie, ou que Rapier a mis le corps en quarantaine, y compris une cible cinématique non finie. `out-of-bounds` signifie qu'une position dynamique sort de ±1e7. `velocity` signifie qu'une position dynamique après le plafond de vitesse sortirait de ±1e7.

Le plafond par défaut de 400 m/s ralentit un corps dynamique plus rapide. Un delta de pas au-dessus de 1 s est refusé avec `PHYSICS2D:INVALID_STEP_DELTA`.

### onContact(handler)

**Signature:**
```ts
function onContact(handler: (event: ContactEvent) => void): void
```

**Description.** Enregistre un gestionnaire pour les événements de collision (quand deux colliders entrent en collision).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| handler | `function` | Appelé avec les informations de collision |

**Retourne:** `void`

**Exemple:**
```ts
const PlayerPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const PlayerActor = defineActor(PlayerPrefab, () => {
  onContact((event) => {
    if (event.started) {
      // Le contact commence dans cette frame
    }
  })
})
```

### ContactEvent

**Signature:**
```ts
interface ContactEvent {
  entityA: bigint;
  entityB: bigint;
  started: boolean;
}
```

### onSensorEnter(sensorId, callback)

**Signature:**
```ts
function onSensorEnter(sensorId: number, callback: (entityId: bigint) => void): () => void
```

**Description.** Appelé quand une autre entité entre dans un collider capteur. Utiliser le `colliderId` du handle de collider comme `sensorId`. Dans un acteur, le callback est retiré quand l'entité de l'acteur est détruite. Hors d'un acteur, appeler la fonction retournée pour le retirer.

**Exemple:**
```ts
export const CoinActor = defineActor(CoinPrefab, () => {
  const zone = useSphereCollider({ radius: 0.5, isSensor: true })
  onSensorEnter(zone.colliderId, (entityId) => {
    // Une entité est entrée dans la zone
    console.log('Collecté par l\'entité :', entityId)
  })
})
```

### onSensorExit(sensorId, callback)

**Signature:**
```ts
function onSensorExit(sensorId: number, callback: (entityId: bigint) => void): () => void
```

**Description.** Appelé quand une autre entité quitte un collider capteur. Retourne une fonction qui retire le callback.

## Couches

### defineLayers(definition)

**Signature:**
```ts
function defineLayers<T extends Record<string, number>>(definition: T): Record<string, number>
```

**Description.** Déclare des couches de collision nommées avec leurs valeurs de bitmask. Le plugin Vite intègre les valeurs de couche au moment du build et avertit si des couches partagent des bits.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| definition | `Record<string, number>` | Objet associant des noms de couches à des valeurs de bitmask |

**Retourne:** `Record<string, number>` — le même objet, avec les noms de couches comme clés.

**Exemple:**
```ts
const Layers = defineLayers({
  player: 1 << 0,
  enemy:  1 << 1,
  wall:   1 << 2,
})
// Utilisez Layers.player, Layers.enemy, Layers.wall
```

## Service de physique

### usePhysics2D()

**Signature:**
```ts
function usePhysics2D(): Physics2DAPI
```

**Description.** Retourne le service de physique pour interroger et manipuler les corps.

**Retourne:** `Physics2DAPI` — API d'exécution de physique.

**Exemple:**
```ts
const physics = usePhysics2D();
physics.applyImpulse(entityId, 10, 0);
```

### Physics2DAPI

**Méthodes:**

| Méthode | Signature | Description |
|---|---|---|
| `applyImpulse` | `(entityId: EntityId, x: number, y: number) => void` | Applique une impulsion linéaire instantanée |
| `setLinearVelocity` | `(entityId: EntityId, vx: number, vy: number) => void` | Remplace la vélocité linéaire (m/s) |
| `getLinearVelocity` | `(entityId: EntityId) => { x: number; y: number } \| null` | Lit la vélocité linéaire actuelle |
| `getPosition` | `(entityId: EntityId) => { x: number; y: number; rotation: number } \| null` | Lit la position et l'angle du corps |
| `getCollisionEventsBatch` | `(opts?) => CollisionEventsBatch` | Récupère tous les événements de collision de cette frame |
| `getCollisionContacts` | `(opts?) => ReadonlyArray<ResolvedCollisionContact>` | Lit les paires de contact actives |
| `getSensorState` | `(entityId: EntityId, sensorId: number) => SensorState` | Lit l'état de chevauchement d'un sensor |

:::tip
La plupart des manipulations de corps (forces, vélocités, impulsions) se font via le handle retourné par `useDynamicBody()` — pas directement via `usePhysics2D()`. L'API service est principalement utilisée pour le polling des événements de collision et les requêtes spatiales.
:::

**Exemple:**
```ts
const physics = usePhysics2D();

// Appliquer une impulsion via l'API service
physics.applyImpulse(entityId, 0, 500)

// Polling des événements de collision chaque frame
onUpdate(() => {
  const batch = physics.getCollisionEventsBatch()
  // traitement du batch...
})
```

## Systèmes

### createPhysicsKinematicSyncSystem(opts)

**Signature:**
```ts
function createPhysicsKinematicSyncSystem(opts?: {
  syncPosition?: boolean;
  syncRotation?: boolean;
}): SystemDef
```

**Description.** Crée un système qui synchronise les positions/rotations des corps cinématiques basées sur les composants Transform.

Physics2DPlugin doit être installé en premier, sinon `engine.use` rejette `CORE:PLUGIN_DEPENDENCY_MISSING`.

**Retourne:** `SystemDef`

**Exemple:**
```ts
const scene = defineScene({
  systems: [
    createPhysicsKinematicSyncSystem({ syncPosition: true, syncRotation: true })
  ]
});
```

### createPlatformerGroundedSystem(opts)

**Signature:**
```ts
function createPlatformerGroundedSystem(opts?: {
  groundLayer?: LayerMask;
  raycastDistance?: number;
}): SystemDef
```

**Description.** Crée un système qui suivre lesquelles entités sont sur le sol (debout sur un sol solide). Utile pour les platformers.

**Retourne:** `SystemDef`

**Exemple:**
```ts
export const MyScene = defineScene({
  name: 'game',
  systems: [
    createPlatformerGroundedSystem({ raycastDistance: 0.1 }),
  ],
})
```

## Support Tilemap

### buildTilemapPhysicsChunks(opts)

**Signature:**
```ts
function buildTilemapPhysicsChunks(opts: {
  tilemap: TilemapData;
  tileSize: number;
  solidTiles: number[];
  chunkSize?: number;
}): void
```

**Description.** Construit les colliders de physique pour une tilemap utilisant le chunking pour la performance.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| opts.tilemap | `TilemapData` | Données de tilemap |
| opts.tileSize | `number` | Taille des tuiles en unités |
| opts.solidTiles | `number[]` | IDs des tuiles qui sont solides |
| opts.chunkSize | `number` | Taille de la grille de chunks (optionnel) |

**Retourne:** `void`

### patchTilemapPhysicsChunk(opts)

**Signature:**
```ts
function patchTilemapPhysicsChunk(opts: {
  tilemap: TilemapData;
  chunkX: number;
  chunkY: number;
}): void
```

**Description.** Reconstruit la physique pour un seul chunk de tilemap (pour les éditions de tilemap dynamiques).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| opts.chunkX | `number` | Chunk grille X |
| opts.chunkY | `number` | Chunk grille Y |

**Retourne:** `void`

## Intégration Vite

### physics2dVitePlugin(options?)

**Signature:**
```ts
function physics2dVitePlugin(options?: Physics2DVitePluginOptions): VitePlugin
// interface Physics2DVitePluginOptions { debug?: boolean }
```

**Description.** Plugin Vite pour bundler Rapier2D WASM. Enregistré automatiquement quand le plugin physics2d est utilisé. Émet un avertissement au moment du build si une couche est définie avec `defineLayers()` mais jamais référencée dans le même fichier — permet de détecter les définitions de couches inutilisées tôt.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `Physics2DVitePluginOptions` | Options optionnelles du plugin au moment du build |
| options.debug | `boolean` | Activer les logs de débogage pour l'intégration des couches (défaut: false) |

**Retourne:** `VitePlugin`

> **Note:** Lors de l'utilisation de la config du module, passez les options du plugin Vite via la sous-clé `vite` :
> ```ts
> // gwen.config.ts
> export default defineConfig({
>   modules: ['@gwenjs/physics2d'],
>   physics2d: {
>     gravity: -9.81,
>     maxLinearVelocity: 400, // mètres par seconde ; aussi le plafond Rapier après chaque sous-pas
>     vite: { debug: true },  // Options du plugin Vite (build uniquement)
>   },
> })
> ```

## Comportement Rapier 0.36

Rapier limite la vitesse linéaire après chaque sous-pas du solveur. Le plafond par défaut est 400 m/s. `maxLinearVelocity` règle le plafond de GWEN et ce plafond Rapier (`crates/gwen-core/src/physics2d/world.rs:787-793`, `crates/gwen-core/src/physics3d/world.rs:811-812`). Un nouveau monde part de 400 (`crates/gwen-core/src/physics2d/world.rs:244`, `crates/gwen-core/src/physics3d/world.rs:716`). Une valeur non finie, nulle ou négative est refusée et les deux plafonds restent.

Un corps s'endort après une demi-seconde sous le seuil de sommeil (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). Une île s'endort une fois que chaque corps qui la compose est éligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

Avec un sous-pas de CCD, une boîte dynamique rapide ne traverse pas un mur fixe mince, même si son propre drapeau CCD est éteint (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). Le préréglage Low garde ce sous-pas (`crates/gwen-core/src/physics2d/world.rs:60-63`, `crates/gwen-core/src/physics3d/components.rs:101-104`). Zéro sous-pas coupe cette CCD, et la même boîte traverse le mur (`crates/gwen-core/src/physics2d/world.rs:1728`).

Des itérations de solveur en plus ajoutent des sous-pas pour toute l'île qui contient le corps. En 2D, `additionalSolverIterations` est stocké à 16 au plus (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:17`, `crates/gwen-core/src/physics2d/world.rs:292`). En 3D, `set_body_solver_iterations` utilise le même plafond 0–16 (`crates/gwen-core/src/physics3d/world.rs:343`, `crates/gwen-core/src/physics3d/world.rs:2807-2809`). 0 n'ajoute aucun sous-pas. 17 et au-dessus sont stockés comme 16. Le plugin physics3d invoque `physics3d_set_body_solver_iterations` seulement quand le nombre choisi est supérieur à 0 (`packages/physics3d/src/plugin/body-management.ts:276-279`).

## Définitions de type

### BoxColliderOptions

```ts
interface BoxColliderOptions {
  width: number;
  height: number;
  sensor?: boolean;
  density?: number;
}
```

### SphereColliderOptions

```ts
interface SphereColliderOptions {
  radius: number;
  sensor?: boolean;
  density?: number;
}
```

### CapsuleColliderOptions

```ts
interface CapsuleColliderOptions {
  halfHeight: number;
  radius: number;
  sensor?: boolean;
  density?: number;
}
```

### DynamicBodyOptions

```ts
interface DynamicBodyOptions {
  mass?: number;
  linearDamping?: number;
  angularDamping?: number;
  gravityScale?: number;
  restitution?: number;
  friction?: number;
  ccdEnabled?: boolean;
}
```

### KinematicBodyOptions

```ts
interface KinematicBodyOptions {
  friction?: number;
  restitution?: number;
}
```

### StaticBodyOptions

```ts
interface StaticBodyOptions {
  friction?: number;
}
```
