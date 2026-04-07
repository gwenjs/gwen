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
defineActor('Ball', (setup) => {
  useDynamicBody({ mass: 2, restitution: 0.8 });
  useBoxCollider({ width: 1, height: 1 });
});
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
defineActor('Ground', (setup) => {
  useStaticBody();
  useBoxCollider({ width: 100, height: 1 });
});
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
| options.width | `number` | Largeur de la boîte |
| options.height | `number` | Hauteur de la boîte |
| options.sensor | `boolean` | Est capteur (déclenchement uniquement) |

**Retourne:** `void`

**Exemple:**
```ts
useBoxCollider({ width: 2, height: 2, sensor: false });
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
| options.radius | `number` | Rayon du cercle |
| options.sensor | `boolean` | Est capteur (déclenchement uniquement) |

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
| options.halfHeight | `number` | Demi-hauteur de la capsule |
| options.radius | `number` | Rayon final |
| options.sensor | `boolean` | Est capteur (déclenchement uniquement) |

**Retourne:** `void`

## Événements

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
defineActor('Player', (setup) => {
  onContact((event) => {
    if (event.other.name === 'Spike') {
      // Prendre des dégâts
    }
  });
});
```

### ContactEvent

**Signature:**
```ts
interface ContactEvent {
  self: Entity;
  other: Entity;
  started: boolean;
  ended: boolean;
  point: Vec2;
  normal: Vec2;
  impulse: number;
}
```

### onSensorEnter(handler)

**Signature:**
```ts
function onSensorEnter(handler: (other: Entity) => void): void
```

**Description.** Appelé quand un autre collider entre dans un déclencheur de capteur.

**Exemple:**
```ts
defineActor('Coin', (setup) => {
  useSphereCollider({ radius: 0.5, sensor: true });
  onSensorEnter((other) => {
    if (other.name === 'Player') {
      // Collecter la pièce
    }
  });
});
```

### onSensorExit(handler)

**Signature:**
```ts
function onSensorExit(handler: (other: Entity) => void): void
```

**Description.** Appelé quand un autre collider quitte un déclencheur de capteur.

## Couches

### defineLayers(names)

**Signature:**
```ts
function defineLayers(names: string[]): LayerMask
```

**Description.** Crée des définitions de couches pour le filtrage des collisions.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| names | `string[]` | Liste des noms de couches |

**Retourne:** `LayerMask` — objet avec des drapeaux de bits de couche.

**Exemple:**
```ts
const Layers = defineLayers(['player', 'enemy', 'wall']);
// Utilisez Layers.player, Layers.enemy, etc.
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
defineSystem({
  setup() {
    const groundedSystem = createPlatformerGroundedSystem({
      raycastDistance: 0.1
    });
  }
});
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
> modules: [['@gwenjs/physics2d', {
>   gravity: -9.81,
>   vite: { debug: true }  // Options du plugin Vite (build uniquement)
> }]]
> ```

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
