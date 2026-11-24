---
title: "@gwenjs/physics2d"
description: "Référence API pour @gwenjs/physics2d."
---

# @gwenjs/physics2d

`pnpm add @gwenjs/physics2d`

Plugin de moteur de physique 2D alimenté par Rapier2D. Fournit la dynamique des corps rigides, les colliders et les capteurs pour les jeux 2D.

```ts check
import { defineComponent, Types } from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import {
  Physics2DPlugin,
  onContact,
  useBoxCollider,
  useDynamicBody,
} from "@gwenjs/physics2d";
import type {
  BoxColliderHandle,
  BoxColliderOptions,
  DynamicBodyHandle,
  DynamicBodyOptions,
  KinematicBodyOptions,
  Physics2DConfig,
  StaticBodyOptions,
} from "@gwenjs/physics2d";

const options: Physics2DConfig = { gravity: { y: -9.81 } };
const plugin = Physics2DPlugin(options);

const Position = defineComponent({
  name: "DocsPhysics2dPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

export const BallActor = defineActor(BallPrefab, () => {
  const bodyOptions: DynamicBodyOptions = { mass: 2, fixedRotation: true };
  const body: DynamicBodyHandle = useDynamicBody(bodyOptions);
  const pose: KinematicBodyOptions<"2d"> = {
    initialPosition: { x: 0, y: 2 },
    initialRotation: 0,
  };
  const ground: StaticBodyOptions = { shape: "box", isSensor: false };
  onContact((contact) => {
    void contact.started;
    void body;
    void pose;
    void ground;
  });
});

export const BoxActor = defineActor(BallPrefab, () => {
  const boxOptions: BoxColliderOptions<"2d"> = { w: 1, h: 1, isSensor: false };
  const box: BoxColliderHandle = useBoxCollider(boxOptions);
  void box;
});

void plugin;
```

## Configuration du plugin

### Physics2DPlugin()

`Physics2DPlugin` est la valeur que `createPhysicsPlugin` construit pour `@gwenjs/physics2d` et la clé de service `physics2d`. Les options sont `Physics2DConfig`. Voir [Plugin](./physics-core#plugin).

`options.layers` associe chaque nom à un indice de bit dans `[0, 31]`, au plus 32 noms. Un bit hors de cet intervalle, ou plus de 32 couches, fait rejeter `CORE:PLUGIN_OPTIONS_INVALID` par `engine.use(Physics2DPlugin(...))`. Le chemin est `layers.<name>` pour un bit et `layers` pour le nombre. L'appel `Physics2DPlugin(...)` ne lève pas pour les couches.

**Exemple :**
```ts
export default defineConfig({
  plugins: [Physics2DPlugin({ gravity: { y: -9.81 } })],
});
```

## Composables

Utilisez ceux-ci à l'intérieur de `defineActor` pour ajouter des composants de physique aux entités.

### useShape(options)

**Signature:**
```ts
function useShape(options: ShapeOptions): void
```

**Description.** Range `w`, `h`, `radius` et `depth` sur l'entité (`ShapeOptions`). `useStaticBody` lit `w`, `h` et `radius`. `useDynamicBody` ne les lit pas. Il ajoute toujours une boîte ou une balle de demi-étendue 0,5.

**Retourne :** `void`

### useDynamicBody(options?)

**Signature :**
```ts
function useDynamicBody(options?: DynamicBodyOptions): DynamicBodyHandle
```

**Description.** Ajoute un corps rigide dynamique. Champs : `shape?`, `layer?`, `mask?`, `mass?`, `linearDamping?`, `angularDamping?`, `fixedRotation?`, `gravityScale?`. `shape: "ball"` ajoute une balle. Toute autre forme ajoute une boîte. Les deux utilisent une demi-étendue de 0,5. Il n'y a pas de champ `restitution`.

**Retourne :** `DynamicBodyHandle` (`bodyId`, `active`, `velocity`, `applyForce`, `applyImpulse`, `setVelocity`, `enable`, `disable`).

**Exemple :**
```ts
const BallPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const BallActor = defineActor(BallPrefab, () => {
  const body = useDynamicBody({ mass: 2, fixedRotation: true })
  void body
})
```

### useKinematicBody(options?)

**Signature :**
```ts
function useKinematicBody(options?: KinematicBodyOptions<"2d">): KinematicBodyHandle
```

**Description.** Ajoute un corps cinématique. Champs : `initialPosition?`, `initialRotation?`, `fixedRotation?`. La gravité ne le déplace pas. On le pilote avec `setVelocity` ou `moveTo`.

**Retourne :** `KinematicBodyHandle`

### useStaticBody(options?)

**Signature :**
```ts
function useStaticBody(options?: StaticBodyOptions): StaticBodyHandle
```

**Description.** Ajoute un corps statique. Champs : `shape?`, `layer?`, `mask?`, `isSensor?`. Quand un composant de forme est présent, une balle utilise son `radius` et une boîte utilise `w / 2` et `h / 2`. Sinon la demi-étendue est 0,5.

**Retourne :** `StaticBodyHandle`

**Exemple:**
```ts
const GroundPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }])

export const GroundActor = defineActor(GroundPrefab, () => {
  useShape({ w: 100, h: 1 })
  useStaticBody()
})
```

## Colliders

### useBoxCollider(options)

**Signature :**
```ts
function useBoxCollider(options: BoxColliderOptions<"2d">): BoxColliderHandle
```

**Description.** Enregistre un corps fixe et un collider boîte sur l'entité de l'acteur. Il n'attache pas une forme à `useDynamicBody`. `w` et `h` sont les tailles complètes. Les demi-étendues du collider sont `w / 2` et `h / 2`. Champs optionnels : `offsetX`, `offsetY`, `isSensor`, `layer`, `mask`, `material`. `material` est accepté et n'est pas appliqué. `oneWay` n'est pas un champ de ce type d'options.

**Retourne :** `BoxColliderHandle` (`colliderId`, `isSensor`)

**Exemple:**
```ts
useBoxCollider({ w: 2, h: 2, isSensor: false });
```

### useSphereCollider(options)

**Signature :**
```ts
function useSphereCollider(options: SphereColliderOptions<"2d">): CircleColliderHandle
```

**Description.** Enregistre un corps fixe et un collider cercle. Il n'attache pas une forme à `useDynamicBody`. Champs : `radius`, et les mêmes `offsetX`, `offsetY`, `isSensor`, `layer`, `mask`, `material` optionnels. `material` est accepté et n'est pas appliqué.

**Retourne :** `CircleColliderHandle` (`colliderId`, `isSensor`)

### useCapsuleCollider(options)

**Signature :**
```ts
function useCapsuleCollider(options: CapsuleColliderOptions<"2d">): CapsuleColliderHandle
```

**Description.** Enregistre un corps fixe. L'API n'a pas de primitive capsule, donc ceci range une boîte. La demi-largeur est `radius`. La demi-hauteur est `height / 2`. Les champs optionnels suivent le filtre de la boîte. `material` est accepté et n'est pas appliqué.

**Retourne :** `CapsuleColliderHandle` (`colliderId`, `isSensor`)

## Événements

### physics2d:body-disabled

Le plugin émet ce hook après un pas qui a désactivé un corps. La charge est `{ entity, reason }`. `reason` vaut `non-finite`, `out-of-bounds` ou `velocity`. Le corps reste enregistré. Une requête ou `getPosition` répond encore. Un corps dynamique et un corps mis en quarantaine par Rapier sont tous les deux inclus (`crates/gwen-core/src/physics2d/world.rs:922`).

```ts
engine.hooks.hook("physics2d:body-disabled", ({ entity, reason }) => {
  // reason vaut "non-finite", "out-of-bounds" ou "velocity"
  void entity;
  void reason;
});
```

`non-finite` signifie qu'une translation ou une vitesse linéaire dynamique n'est pas finie, ou que Rapier a mis le corps en quarantaine, y compris une cible cinématique non finie. `out-of-bounds` signifie qu'une position dynamique sort de ±1e7. `velocity` signifie qu'une position dynamique après le plafond de vitesse sortirait de ±1e7.

Le plafond par défaut de 400 m/s ralentit un corps dynamique plus rapide. Un delta de pas au-dessus de 1 s est refusé avec `PHYSICS2D:INVALID_STEP_DELTA`.

### onContact(handler, entityId?)

**Signature:**
```ts
function onContact(callback: (contact: CollisionContact) => void, entityId?: EntityId): () => void
```

**Description.** Enregistre un gestionnaire pour les événements de collision (quand deux colliders entrent en collision).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| handler | `function` | Appelé avec les informations de collision |
| entityId | `EntityId` | Optionnel. Limite le callback aux contacts qui incluent cette entité. Dans `defineActor`, l'entité de l'acteur est utilisée quand ce paramètre est omis. |

**Retourne:** `() => void`

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

### CollisionContact

`CollisionContact` vient de `@gwenjs/physics-core`. Champs : `entityA`, `entityB`, `aColliderId` et `bColliderId` optionnels, et `started`.

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

`Physics2DPlugin({ layers })` prend des indices de bit. Un bit hors de `[0, 31]`, ou plus de 32 couches, fait rejeter `CORE:PLUGIN_OPTIONS_INVALID` par `engine.use(Physics2DPlugin(...))` (chemins `layers.<name>` et `layers`). L'appel de la fabrique ne lève pas pour les couches.

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

### Requêtes spatiales

`queryRadius`, `queryRect` et `pointQuery` renvoient toutes les entités qui chevauchent la forme donnée. Les trois acceptent un `QueryFilterOpts` optionnel pour restreindre par couche.

```ts
const physics = usePhysics2D();

// Tous les ennemis dans les 5 mètres autour du joueur
const nearby = physics.queryRadius(player.x, player.y, 5, {
  mask: ['enemy'],
})

// Tout ce qui chevauche une zone de déclenchement de 4×2
const inZone = physics.queryRect(doorX, doorY, 2, 1, {
  mask: ['player', 'item'],
})

// Qu'y a-t-il à la position du curseur ?
const underCursor = physics.pointQuery(worldX, worldY)
```

### setLinearDamping

Règle l'amortissement linéaire d'un corps dynamique déjà créé, sans le retirer ni le recréer. Utile au passage glace / eau.

```ts
const physics = usePhysics2D();

// Entrée dans l'eau — ralentir progressivement
physics.setLinearDamping(entityId, 4.0)

// Retour sur terre — rétablir la valeur par défaut
physics.setLinearDamping(entityId, 0.0)
```

### Plates-formes à sens unique

`oneWay` est un champ de `ColliderOptions`. `addBoxCollider` le lit et le passe au collider boîte. `useBoxCollider` ne l'accepte pas.

```ts
const physics = usePhysics2D()
physics.addBoxCollider(entityId, 2, 0.1, { oneWay: true })
```

## Systèmes

### createPhysicsKinematicSyncSystem(options)

**Signature :**
```ts
function createPhysicsKinematicSyncSystem(
  options?: PhysicsKinematicSyncSystemOptions,
): GwenPlugin
```

**Description.** Renvoie l'objet plugin de `definePlugin`. À chaque frame il copie la position ECS dans le corps cinématique. `positionComponent` est requis à l'exécution. Sans lui, l'appel lève `Physics2DErrorCodes.POSITION_COMPONENT_REQUIRED`. Le paramètre est typé optionnel. `pixelsPerMeter` vaut 50 par défaut.

`Physics2DPlugin` doit être installé d'abord. Sinon `engine.use` rejette `CORE:PLUGIN_DEPENDENCY_MISSING`.

**Retourne :** `GwenPlugin`

**Exemple:**
```ts
await engine.use(Physics2DPlugin({ gravity: { x: 0, y: 0 } }))
await engine.use(createPhysicsKinematicSyncSystem({ pixelsPerMeter: 50, positionComponent: Position }))
```

### createPlatformerGroundedSystem(opts)

**Signature :**
```ts
function createPlatformerGroundedSystem(
  options: PlatformerGroundedSystemOptions & { physics: Physics2DAPI },
): { isGrounded(entityId: EntityId): boolean; getSensorState(entityId: EntityId): SensorState }
```

**Description.** Ce n'est pas une définition de système. Il lit le capteur de pied via `physics.getSensorState`. `sensorId` vaut `SENSOR_ID_FOOT` par défaut. Il n'y a ni `groundLayer` ni `raycastDistance`.

**Retourne :** `{ isGrounded, getSensorState }`

**Exemple :**
```ts
const physics = usePhysics2D()
const grounded = createPlatformerGroundedSystem({ physics })
```

## Support Tilemap

### buildTilemapPhysicsChunks(opts)

**Signature :**
```ts
function buildTilemapPhysicsChunks(
  input: BuildTilemapPhysicsChunksInput,
): TilemapPhysicsChunkMap
```

**Description.** Cuit une grille de tuiles en chunks physiques. Champs : `tiles`, `mapWidthTiles`, `mapHeightTiles`, et en option `chunkSizeTiles`, `tileSizePx` et `isSolidTile`. Il ne prend ni `tilemap`, ni `tileSize`, ni `solidTiles`.

**Retourne :** `TilemapPhysicsChunkMap`

### patchTilemapPhysicsChunk(opts)

**Signature :**
```ts
function patchTilemapPhysicsChunk(
  input: PatchTilemapPhysicsChunkInput,
): TilemapPhysicsChunkMap
```

**Description.** Reconstruit un chunk. Champs : `source` (`BuildTilemapPhysicsChunksInput`), `chunkX`, `chunkY` et `previous` (`TilemapPhysicsChunkMap`).

**Retourne :** `TilemapPhysicsChunkMap`

## Intégration Vite

### physics2dVitePlugin(options?)

**Signature:**
```ts
function physics2dVitePlugin(options?: Physics2DVitePluginOptions): Plugin
// import { physics2dVitePlugin } from '@gwenjs/physics2d/module'
```

**Description.** Enregistre l'unité `gwen:layer-inline` sur `gwen:transform-pipeline`. Enregistré automatiquement quand le module physics2d est utilisé. Une config Vite manuelle exige `gwen()` de `@gwenjs/vite` dans la config Vite. `Physics2DVitePluginOptions` est vide.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `Physics2DVitePluginOptions` | Vide. Le plugin ne prend aucune option |

**Retourne :** `Plugin` (le type de plugin Vite). `Physics2DVitePluginOptions` est un enregistrement vide.

> **Note :** `Physics2DConfig` n'a pas de clé `vite`. Le module appelle `physics2dVitePlugin()` sans option.
> ```ts
> // gwen.config.ts
> export default defineConfig({
>   modules: ['@gwenjs/physics2d'],
>   physics2d: {
>     gravity: { y: -9.81 },
>     maxLinearVelocity: 400, // mètres par seconde ; aussi le plafond Rapier après chaque sous-pas
>   },
> })
> ```

## Comportement Rapier 0.36

Rapier limite la vitesse linéaire après chaque sous-pas du solveur. Le plafond par défaut est 400 m/s. `maxLinearVelocity` règle le plafond de GWEN et ce plafond Rapier (`crates/gwen-core/src/physics2d/world.rs:752-753`, `crates/gwen-core/src/physics3d/world.rs:809-810`). Un nouveau monde part de 400 (`crates/gwen-core/src/physics2d/world.rs:200`, `crates/gwen-core/src/physics3d/world.rs:714`). Une valeur non finie, nulle ou négative est refusée et les deux plafonds restent.

Un corps s'endort après une demi-seconde sous le seuil de sommeil (`rapier3d-0.36.1/src/dynamics/rigid_body_components.rs:1375`, `crates/gwen-core/tests/physics3d_rapier_036.rs:333`). Une île s'endort une fois que chaque corps qui la compose est éligible (`crates/gwen-core/tests/physics3d_rapier_036.rs:356`).

Avec un sous-pas de CCD, une boîte dynamique rapide ne traverse pas un mur fixe mince, même si son propre drapeau CCD est éteint (`crates/gwen-core/tests/physics2d_rapier_036.rs:241`). Le préréglage Low garde ce sous-pas (`crates/gwen-core/src/physics_common/quality.rs:43-47`). Zéro sous-pas coupe cette CCD, et la même boîte traverse le mur (`crates/gwen-core/src/physics2d/world.rs:1711`).

Des itérations de solveur en plus ajoutent des sous-pas pour toute l'île qui contient le corps. En 2D, `additionalSolverIterations` est stocké à 16 au plus (`packages/physics2d/src/types/api.ts:71`, `crates/gwen-core/src/physics2d/world.rs:19`, `crates/gwen-core/src/physics2d/world.rs:252`). En 3D, `set_body_solver_iterations` utilise le même plafond 0–16 (`crates/gwen-core/src/physics3d/world.rs:341`, `crates/gwen-core/src/physics3d/world.rs:2805-2807`). 0 n'ajoute aucun sous-pas. 17 et au-dessus sont stockés comme 16. Le plugin physics3d invoque `physics3d_set_body_solver_iterations` seulement quand le nombre choisi est supérieur à 0 (`packages/physics3d/src/plugin/body-management.ts:277-280`).

## Définitions de type

### BoxColliderOptions

`BoxColliderOptions<"2d">` est le filtre partagé (`layer?`, `mask?`, `isSensor?`, `material?`) plus `w`, `h`, `offsetX?` et `offsetY?`. Il n'y a pas de champ `width`. `d` n'existe que sur la forme 3D.

### SphereColliderOptions

`SphereColliderOptions<"2d">` est le même filtre plus `radius`, `offsetX?` et `offsetY?`.

### CapsuleColliderOptions

`CapsuleColliderOptions<"2d">` est le même filtre plus `radius`, `height`, `offsetX?` et `offsetY?`.

### DynamicBodyOptions

Champs : `shape?` (`"box"` ou `"ball"`), `layer?`, `mask?`, `mass?`, `linearDamping?`, `angularDamping?`, `fixedRotation?`, `gravityScale?`.

### KinematicBodyOptions<"2d">

Utilisez `KinematicBodyOptions<"2d">`. Champs : `initialPosition?` (`Vec2`), `initialRotation?` (radians), `fixedRotation?`. Le type est déclaré une fois, dans `@gwenjs/physics-core`.

### StaticBodyOptions

Champs : `shape?` (`"box"` ou `"ball"`), `layer?`, `mask?`, `isSensor?`.

### QueryFilterOpts

Filtre de couches optionnel accepté par `queryRadius`, `queryRect` et `pointQuery`.

```ts
interface QueryFilterOpts {
  /** Couches auxquelles la forme de requête appartient. Nom, bitmask, ou une liste des deux. */
  layer?: string | number | readonly (string | number)[];
  /** Couches que la requête peut toucher. Nom, bitmask, ou une liste des deux. */
  mask?: string | number | readonly (string | number)[];
}
```

Quand ils sont omis, les deux champs valent `0xFFFFFFFF` (toutes les couches).

