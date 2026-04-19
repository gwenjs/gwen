---
title: "@gwenjs/core"
description: "Référence API pour @gwenjs/core."
---

# @gwenjs/core

`pnpm add @gwenjs/core`

Moteur ECS principal, composants, systèmes, acteurs et hooks de cycle de vie du framework GWEN.

## Moteur

### createEngine(options)

**Signature:**
```ts
function createEngine(options: GwenEngineOptions): GwenEngine
```

**Description.** Crée et initialise le moteur GWEN avec la configuration fournie. C'est la base de votre jeu/app.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `GwenEngineOptions` | Configuration du moteur (scènes, plugins, etc.) |

**Retourne:** `GwenEngine` — l'instance du moteur initialisée.

**Exemple:**
```ts
const engine = await createEngine({
  maxEntities: 10_000,
  variant: 'physics2d',
  debug: true,
})
```

### useEngine()

**Signature:**
```ts
function useEngine(): GwenEngine
```

**Description.** Retourne l'instance du moteur courant à l'intérieur d'une configuration système ou composable. Doit être appelé lors de l'initialisation du système.

**Retourne:** `GwenEngine` — le moteur actif.

**Exemple:**
```ts
const MySystem = defineSystem('MySystem', () => {
  const engine = useEngine()
  console.log(engine.deltaTime)
})
```

## Composants

### defineComponent(options)

**Signature:**
```ts
// Forme objet (recommandée)
function defineComponent<T>(options: {
  name: string;
  schema: T;
}): ComponentDef<T>

// Forme factory (schéma dynamique)
function defineComponent<T>(name: string, factory: () => { schema: T }): ComponentDef<T>
```

**Description.** Définit un type de composant SoA (Structure-of-Arrays). Les données sont stockées dans des buffers WASM typés — il n'y a pas de hooks de cycle de vie sur les composants.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| `options.name` | `string` | Nom de composant unique |
| `options.schema` | `T` | Champs et types WASM (`Types.f32`, `Types.i32`, etc.) |

**Retourne:** `ComponentDef<T>` — définition à référencer dans les prefabs et requêtes.

**Exemple:**
```ts
export const Health = defineComponent({
  name: 'Health',
  schema: {
    hp:    Types.f32,
    maxHp: Types.f32,
  },
})
```

### Types

**Signature:**
```ts
const Types = {
  f32: Type,
  f64: Type,
  i32: Type,
  ui32: Type,
  i8: Type,
  ui8: Type,
  i16: Type,
  ui16: Type
}
```

**Description.** Constantes de type pour définir des schémas de composants.

**Exemple:**
```ts
schema: {
  position: Types.f32,
  count: Types.i32
}
```

### useComponent(ComponentDef)

**Signature:**
```ts
function useComponent<T extends Record<string, any>>(def: ComponentDef): T
```

**Description.** Retourne un proxy live sur les données du composant de l'acteur courant. Les lectures et écritures de champs sont transmises directement à l'ECS. Doit être appelé pendant la phase de setup.

**Retourne:** `T` — objet proxy exposant les champs du composant directement (ex. `health.hp`, pas `health.value.hp`).

**Exemple:**
```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  const health = useComponent(Health)
  onStart(() => {
    console.log('hp:', health.hp)
  })
})
```

## Systèmes

### defineSystem(setup)

**Signature:**
```ts
function defineSystem(setup: () => void): GwenPlugin
function defineSystem(name: string, setup: () => void): GwenPlugin
```

**Description.** Définit un système qui s'exécute une fois lors de l'initialisation. Utilisez les hooks de cycle de vie et les requêtes à l'intérieur de setup.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| `name` | `string` | Nom du système (optionnel, injecté automatiquement par le plugin Vite) |
| `setup` | `function` | Fonction de setup appelée une fois à l'initialisation |

**Retourne:** `GwenPlugin` — plugin à enregistrer dans une scène ou la config.

**Exemple:**
```ts
export const MovementSystem = defineSystem('MovementSystem', () => {
  const entities = useQuery([Transform, Velocity])
  onUpdate((dt) => {
    for (const id of entities) {
      Transform.x[id] += Velocity.x[id] * dt
    }
  })
})
```

### useQuery(components, opts?)

**Signature:**
```ts
function useQuery(components: ComponentDef[]): LiveQuery
```

**Description.** Crée une requête vivante qui itère sur toutes les entités ayant les composants spécifiés. La requête se met à jour automatiquement quand les entités correspondent/ne correspondent pas.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| components | `ComponentDef[]` | Composants à requêter |
| opts.onChange | `function` | Appelé quand les entités sont ajoutées/retirées de la requête |

**Retourne:** `LiveQuery` — un ensemble itérable d'entités correspondantes.

**Exemple:**
```ts
const query = useQuery([Position, Velocity]);
onUpdate(() => {
  for (const entity of query) {
    // Mettre à jour la position
  }
});
```

## Hooks de cycle de vie

### onUpdate(cb)

**Signature:**
```ts
function onUpdate(cb: (deltaTime: number) => void): void
```

**Description.** Enregistre un callback à exécuter à chaque frame lors de la phase de mise à jour.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| cb | `function` | Callback recevant deltaTime en secondes |

**Retourne:** `void`

**Exemple:**
```ts
onUpdate((dt) => {
  console.log('Frame time:', dt);
});
```

### onBeforeUpdate(cb)

**Signature:**
```ts
function onBeforeUpdate(cb: () => void): void
```

**Description.** Enregistre un callback à exécuter avant la phase de mise à jour principale.

**Retourne:** `void`

### onAfterUpdate(cb)

**Signature:**
```ts
function onAfterUpdate(cb: () => void): void
```

**Description.** Enregistre un callback à exécuter après la phase de mise à jour principale.

**Retourne:** `void`

### onRender(cb)

**Signature:**
```ts
function onRender(cb: () => void): void
```

**Description.** Enregistre un callback à exécuter lors de la phase de rendu.

**Retourne:** `void`

### onStart(cb)

**Signature:**
```ts
function onStart(cb: () => void): void
```

**Description.** Enregistre un callback à exécuter quand le moteur démarre ou qu'une scène est entrée.

**Retourne:** `void`

### onDestroy(cb)

**Signature:**
```ts
function onDestroy(cb: () => void): void
```

**Description.** Enregistre un callback à exécuter quand le moteur s'arrête ou qu'une scène est quittée.

**Retourne:** `void`

### onEvent(type, handler)

**Signature:**
```ts
function onEvent<T = any>(type: string, handler: (payload: T) => void): void
```

**Description.** Enregistre un gestionnaire pour les événements personnalisés émis avec [`emit()`](#emitevent-payload).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| type | `string` | Identifiant du type d'événement |
| handler | `function` | Gestionnaire recevant la charge utile de l'événement |

**Retourne:** `void`

**Exemple:**
```ts
onEvent('player-hit', (damage) => {
  console.log('Player took', damage, 'damage');
});
```

## Scènes

### defineScene(name, factory)

**Signature:**
```ts
function defineScene(name: string, factory: () => void): SceneFactory
```

**Description.** Définit une scène de jeu. La factory s'exécute dans un contexte engine actif au démarrage — tous les composables engine sont disponibles. Déclarez les systèmes et les hooks de cycle de vie via des composables. Le résultat est mis en cache, la factory ne s'exécute qu'une seule fois.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Nom unique de la scène (utilisé par le routeur) |
| factory | `() => void` | Fonction de setup — appelez `useSystem`, `onEnter`, `onExit` ici |

**Retourne:** `SceneFactory` — appelable, avec une propriété `.sceneName`.

**Exemple:**
```ts
export const GameScene = defineScene('game', () => {
  useSystem([MovementSystem, RenderSystem])

  const player = useActor(PlayerActor)
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
  onExit(() => player.despawnAll())
})
```

### useSystem(plugins)

**Signature:**
```ts
function useSystem(plugins: GwenPlugin[]): void
```

**Description.** Déclare les systèmes actifs pendant cette scène. Doit être appelé dans la factory d'un `defineScene()`.

**Lève:** `GwenContextError` si appelé hors d'une factory `defineScene()`.

**Exemple:**
```ts
defineScene('game', () => {
  useSystem([MovementSystem, RenderSystem, CollisionSystem])
})
```

### onEnter(cb)

**Signature:**
```ts
function onEnter(cb: (params?: Record<string, unknown>) => void | Promise<void>): void
```

**Description.** Enregistre un callback déclenché quand le routeur entre dans cette scène. Reçoit les params passés à `nav.send()`. Doit être appelé dans la factory d'un `defineScene()`.

**Lève:** `GwenContextError` si appelé hors d'une factory `defineScene()`.

**Exemple:**
```ts
defineScene('game', () => {
  const player = useActor(PlayerActor)
  onEnter(() => player.spawnOnce({ x: 400, y: 530 }))
})
```

### onExit(cb)

**Signature:**
```ts
function onExit(cb: () => void | Promise<void>): void
```

**Description.** Enregistre un callback déclenché quand le routeur quitte cette scène. Doit être appelé dans la factory d'un `defineScene()`.

**Lève:** `GwenContextError` si appelé hors d'une factory `defineScene()`.

**Exemple:**
```ts
defineScene('game', () => {
  const player = useActor(PlayerActor)
  onExit(() => player.despawnAll())
})
```

### defineSceneRouter(options)

**Signature:**
```ts
function defineSceneRouter(options: {
  initial: string;
  routes: Record<string, { scene: SceneFactory; on?: Record<string, string> }>;
}): SceneRouterDef
```

**Description.** Définit un routeur de scènes pour gérer les transitions.

**Retourne:** `SceneRouterDef`

**Exemple:**
```ts
export const AppRouter = defineSceneRouter({
  initial: 'menu',
  routes: {
    menu: { scene: MenuScene, on: { START: 'game' } },
    game: { scene: GameScene, on: { PAUSE: 'pause' } },
  },
})
```

### useSceneRouter(routerDef)

**Signature:**
```ts
function useSceneRouter<TRoutes>(routerDef: SceneRouterDef<TRoutes>): SceneRouterHandle<TRoutes>
```

**Description.** Retourne le handle runtime pour un routeur de scènes. Appelez `.send()` pour déclencher des transitions.

**Retourne:** `SceneRouterHandle` — `{ send, can, current, params }`.

**Exemple:**
```ts
const nav = useSceneRouter(AppRouter)
await nav.send('START')
```

## Acteurs

### defineActor(prefab, factory)

**Signature:**
```ts
function defineActor<Props = void>(
  prefab: PrefabDefinition,
  factory: (props?: Props) => Record<string, unknown>
): ActorDef
```

**Description.** Définit un acteur — un modèle d'entité avec des hooks de cycle de vie et une API publique. La `factory` s'exécute une fois par instance générée ; les hooks de cycle de vie (`onStart`, `onUpdate`, `onDestroy`, `onEvent`) sont enregistrés à l'intérieur. L'objet retourné devient l'API publique de l'acteur.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| `prefab` | `PrefabDefinition` | Ensemble de composants et valeurs par défaut, défini avec `definePrefab()` |
| `factory` | `(props?) => object` | Exécutée une fois par spawn — enregistrez les hooks ici, retournez l'API publique |

**Retourne:** `ActorDef` — utilisez `ActorDef._plugin` pour spawner et despawner des instances.

**Exemple:**
```ts
import { defineActor, definePrefab, onStart, onDestroy, useEntityId } from '@gwenjs/core/actor'

const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Health,   defaults: { hp: 100 } },
])

export const EnemyActor = defineActor(EnemyPrefab, (props: { hp: number }) => {
  const entityId = useEntityId()
  onStart(() => {
    Health.hp[entityId] = props.hp
  })
  onDestroy(() => {
    console.log('Enemy détruit')
  })
  return {
    takeDamage: (n: number) => { Health.hp[entityId] -= n },
  }
})

// Enregistrer au démarrage
await engine.use(EnemyActor._plugin)

// Spawn et despawn via useActor() dans un système ou acteur :
const SpawnerSystem = defineSystem(() => {
  const enemies = useActor(EnemyActor)
  const id = enemies.spawn({ hp: 50 })
  enemies.despawn(id)
})
```

### useActor(ActorDef)

**Signature:**
```ts
function useActor<Props, PublicAPI>(def: ActorDefinition<Props, PublicAPI>): ActorHandle<Props, PublicAPI>
```

**Description.** Retourne un handle typé pour spawner, despawner et accéder aux instances d'un acteur. Doit être appelé pendant la phase de setup d'un système ou d'un acteur (pas dans les callbacks de cycle de vie).

**Retourne:** `ActorHandle` — objet avec `spawn`, `despawn`, `despawnAll`, `count`, `get`, `getAll`, `spawnOnce`.

### usePrefab(PrefabDef)

**Signature:**
```ts
function usePrefab(def: PrefabDef): () => Entity
```

**Description.** Retourne une fonction de génération pour un prefab.

**Retourne:** `() => Entity` — fonction pour générer le prefab.

**Exemple:**
```ts
const spawnBullet = usePrefab(BulletPrefab);
const bullet = spawnBullet();
```

### placeActor(def, overrides?)

**Signature:**
```ts
function placeActor(def: ActorDef, overrides?: Record<string, any>): Entity
```

**Description.** Génère immédiatement un acteur dans la scène courante.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| def | `ActorDef` | Définition d'acteur |
| overrides | `object` | Surcharges de propriétés de composants |

**Retourne:** `Entity` — l'entité générée.

**Exemple:**
```ts
const enemy = placeActor(Enemy, { health: { hp: 50 } });
```

### placePrefab(def, overrides?)

**Signature:**
```ts
function placePrefab(def: PrefabDef, overrides?: Record<string, any>): Entity
```

**Description.** Génère immédiatement un prefab dans la scène courante.

**Retourne:** `Entity` — l'entité générée.

### placeGroup(actors)

**Signature:**
```ts
function placeGroup(actors: (ActorDef | () => ActorDef)[]): Entity[]
```

**Description.** Génère plusieurs acteurs à la fois.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| actors | `array` | Tableau de définitions d'acteurs ou de fabriques |

**Retourne:** `Entity[]` — tableau d'entités générées.

## Prefabs

### definePrefab(entries)

**Signature:**
```ts
function definePrefab(entries: Array<{ def: ComponentDef; defaults: Record<string, any> }>): PrefabDef
```

**Description.** Définit un modèle d'entité réutilisable (prefab) avec des composants prédéfinis et des valeurs par défaut.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| entries | `Array<{ def, defaults }>` | Liste de composants avec leurs valeurs par défaut |

**Retourne:** `PrefabDef` — définition de prefab.

**Exemple:**
```ts
const BulletPrefab = definePrefab([
  { def: Transform, defaults: { x: 0, y: 0 } },
  { def: Velocity,  defaults: { x: 0, y: 0 } },
])
```

## Interface utilisateur et mise en page

### defineLayout(name, setup)

**Signature:**
```ts
function defineLayout(name: string, setup: (ctx: LayoutContext) => void): LayoutDef
```

**Description.** Définit une couche d'interface utilisateur persistante qui superpose le jeu.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Nom de mise en page unique |
| setup | `function` | Fonction de setup pour l'initialisation de l'interface utilisateur |

**Retourne:** `LayoutDef`

**Exemple:**
```ts
const HUD = defineLayout('HUD', (setup) => {
  // Initialiser les éléments UI
});
```

### useLayout()

**Signature:**
```ts
function useLayout(): Layout
```

**Description.** Retourne le contexte de mise en page courant. À utiliser pour ajouter/retirer des éléments d'interface utilisateur.

**Retourne:** `Layout`

### useEntityId()

**Signature:**
```ts
function useEntityId(): bigint
```

**Description.** Retourne l'identifiant ECS (`bigint`) de l'acteur en cours d'initialisation. La valeur est unique et stable pendant toute la durée de vie de l'acteur (du spawn au despawn).

Doit être appelé pendant la **phase setup** de la factory `defineActor()` — c'est-à-dire au niveau supérieur de la fonction factory, pas dans `onStart`, `onUpdate` ou d'autres callbacks.

**Retourne:** `bigint` — l'identifiant d'entité de l'acteur en cours de spawn.

**Lève une exception:** Si appelé hors d'un contexte `defineActor()` actif.

**Exemple — acteur singleton (clé statique préférable) :**
```ts
import { defineActor } from '@gwenjs/core/actor'

export const HudActor = defineActor(HudPrefab, () => {
  // Un seul HUD existe — une clé statique est plus claire
  const hud = useHTML('hud', 'score')
})
```

**Exemple — instances multiples (clé unique par acteur) :**
```ts
import { defineActor, useEntityId } from '@gwenjs/core/actor'

export const EnemyActor = defineActor(EnemyPrefab, () => {
  const id = useEntityId()
  const label = useHTML('ui', String(id))  // slot unique par ennemi
})
```

**Exemple — dans un composable :**
```ts
import { useEntityId } from '@gwenjs/core/actor'
import { useService } from '@gwenjs/core/system'
import { onCleanup } from '@gwenjs/core'

export function useSprite(src: string): SpriteHandle {
  const id = useEntityId()
  const service = useService('renderer:canvas')
  const sprite = service.allocateSprite(String(id), src)
  onCleanup(() => sprite.destroy())
  return sprite
}
```

---

### useTransform()

**Signature:**
```ts
function useTransform(): Transform
```

**Description.** Retourne le composant de transformation de l'entité courante.

**Retourne:** `Transform` — avec des propriétés de position, rotation, échelle.

**Exemple:**
```ts
const transform = useTransform();
transform.x += 10;
```

## Événements

### defineHooks(map)

**Signature:**
```ts
function defineHooks(map: Record<string, any>): HookDef
```

**Description.** Définit les types de hooks pour votre jeu.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| map | `object` | Définitions de types de hooks |

**Retourne:** `HookDef`

**Exemple:**
```ts
const Hooks = defineHooks({
  'player-hit': { damage: Number },
  'level-complete': { time: Number }
});
```

### emit(event, payload)

**Signature:**
```ts
function emit(event: string, payload?: any): void
```

**Description.** Émet un événement personnalisé à tous les écouteurs enregistrés avec [`onEvent()`](#oneventtype-handler).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| event | `string` | Identifiant du type d'événement |
| payload | `any` | Charge utile de l'événement (optionnel) |

**Retourne:** `void`

**Exemple:**
```ts
emit('player-hit', { damage: 10 });
```

## Utilitaires

### createLogger(name, opts?)

**Signature:**
```ts
function createLogger(name: string, opts?: LoggerOptions): GwenLogger
```

**Description.** Crée une instance de journal nommée pour le débogage et la journalisation.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Nom de l'espace de noms du journal |
| opts | `object` | Options du journal (optionnel) |

**Retourne:** `GwenLogger` — avec des méthodes: `.info()`, `.warn()`, `.error()`, `.debug()`

**Exemple:**
```ts
const log = createLogger('Player');
log.info('Player spawned');
```

### useTween(options)

**Signature:**
```ts
function useTween(options: {
  duration: number;
  easing?: EasingFunction;
  loop?: boolean;
  onProgress?: (t: number) => void;
  onComplete?: () => void;
}): TweenHandle
```

**Description.** Crée une animation tween. Retourne un gestionnaire avec les méthodes `.play()`, `.stop()`, et `.to(target)`.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.duration | `number` | Durée en secondes |
| options.easing | `function` | Fonction d'atténuation (optionnel) |
| options.loop | `boolean` | Boucler l'animation (optionnel) |
| options.onProgress | `function` | Callback de progression (0–1) |
| options.onComplete | `function` | Callback de complétion |

**Retourne:** `TweenHandle` — contrôleur tween.

**Exemple:**
```ts
const tween = useTween({
  duration: 1,
  onProgress: (t) => { entity.x = lerp(0, 100, t); }
});
tween.play();
```

### createGwenHooks()

**Signature:**
```ts
function createGwenHooks(): GwenHooks
```

**Description.** Crée une instance de hooks pour le développement de plugins avancés.

**Retourne:** `GwenHooks`

### useService(name)

**Signature:**
```ts
function useService(name: string): any
```

**Description.** Retourne un service enregistré par un plugin.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Nom du service |

**Retourne:** `any` — l'instance du service.

**Exemple:**
```ts
const physics = useService('physics');
```

### useWasmModule(name)

**Signature:**
```ts
function useWasmModule(name: string): any
```

**Description.** Retourne un module WASM chargé par un plugin.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Nom du module WASM |

**Retourne:** `any` — le gestionnaire du module WASM.

## Gestion des erreurs

### CoreErrorCodes

**Signature:**
```ts
enum CoreErrorCodes {
  INVALID_COMPONENT = 'INVALID_COMPONENT',
  INVALID_SYSTEM = 'INVALID_SYSTEM',
  INVALID_ACTOR = 'INVALID_ACTOR',
  SCENE_NOT_FOUND = 'SCENE_NOT_FOUND',
  // ... autres codes d'erreur
}
```

**Description.** Énumération des codes d'erreur levés par le moteur principal.

## Contexte

### engineContext

**Signature:**
```ts
const engineContext: AsyncLocalStorage<GwenEngine>
```

**Description.** Stockage de contexte asynchrone brut pour le moteur courant. Généralement pas nécessaire; utilisez [`useEngine()`](#useengine) à la place.
