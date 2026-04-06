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
defineSystem({
  setup() {
    const engine = useEngine();
    console.log(engine.deltaTime);
  }
});
```

## Composants

### defineComponent(options)

**Signature:**
```ts
function defineComponent<T = {}>(options: {
  name: string;
  schema?: T;
  onAdd?: (entity: Entity) => void;
  onRemove?: (entity: Entity) => void;
}): ComponentDef<T>
```

**Description.** Définit un type de composant avec un schéma optionnel et des hooks de cycle de vie.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `object` | Définition du composant |
| options.name | `string` | Nom de composant unique |
| options.schema | `T` | Schéma des champs utilisant Types (optionnel) |
| options.onAdd | `function` | Appelé quand le composant est ajouté à une entité |
| options.onRemove | `function` | Appelé quand le composant est retiré |

**Retourne:** `ComponentDef<T>` — définition du composant pour utilisation dans des acteurs/scènes.

**Exemple:**
```ts
const Health = defineComponent({
  name: 'Health',
  schema: {
    hp: Types.f32,
    maxHp: Types.f32
  },
  onAdd(entity) {
    console.log('Entity took health component');
  }
});
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
function useComponent<T = {}>(def: ComponentDef<T>): void
```

**Description.** Enregistre un composant pour utilisation dans l'acteur courant lors de l'initialisation.

**Retourne:** `void`

**Exemple:**
```ts
defineActor('Player', setup() {
  useComponent(Health);
});
```

## Systèmes

### defineSystem(setup)

**Signature:**
```ts
function defineSystem(options: {
  setup: (ctx: SystemContext) => void;
}): SystemDef
```

**Description.** Définit un système qui s'exécute une fois lors de l'initialisation. Utilisez les hooks de cycle de vie et les requêtes à l'intérieur de setup.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.setup | `function` | Fonction de setup appelée une fois lors de l'initialisation |

**Retourne:** `SystemDef` — définition du système pour enregistrement de scène.

**Exemple:**
```ts
defineSystem({
  setup() {
    const query = useQuery([Transform, Velocity]);
    onUpdate((dt) => {
      for (const entity of query) {
        entity.transform.x += entity.velocity.x * dt;
      }
    });
  }
});
```

### useQuery(components, opts?)

**Signature:**
```ts
function useQuery<C extends ComponentDef[]>(
  components: C,
  opts?: { onChange?: (added: Entity[], removed: Entity[]) => void }
): LiveQuery
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

### defineScene(options)

**Signature:**
```ts
function defineScene(options: {
  name: string;
  systems?: SystemDef[];
  actors?: ActorDef[];
}): SceneDef
```

**Description.** Définit une scène avec des systèmes et des acteurs initiaux.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.name | `string` | Nom de scène unique |
| options.systems | `SystemDef[]` | Systèmes à exécuter dans cette scène |
| options.actors | `ActorDef[]` | Acteurs initiaux à générer |

**Retourne:** `SceneDef` — définition de scène.

**Exemple:**
```ts
const GameScene = defineScene({
  name: 'Game',
  systems: [PhysicsSystem, InputSystem],
  actors: [Player, Enemy]
});
```

### defineSceneRouter(options)

**Signature:**
```ts
function defineSceneRouter(options: {
  initial: string;
  scenes: Record<string, SceneDef>;
}): SceneRouterDef
```

**Description.** Définit un routeur de scène pour gérer les transitions de scène.

**Retourne:** `SceneRouterDef`

**Exemple:**
```ts
defineSceneRouter({
  initial: 'Menu',
  scenes: { Menu: MenuScene, Game: GameScene }
});
```

### useSceneRouter()

**Signature:**
```ts
function useSceneRouter(): SceneRouter
```

**Description.** Retourne le routeur de scène actif. À utiliser pour faire transitionner entre les scènes.

**Retourne:** `SceneRouter` — avec des méthodes comme `.goTo(name)`.

**Exemple:**
```ts
const router = useSceneRouter();
router.goTo('Game');
```

## Acteurs

### defineActor(name, setup)

**Signature:**
```ts
function defineActor(name: string, setup: (ctx: ActorContext) => void): ActorDef
```

**Description.** Définit un acteur (modèle d'entité) avec des composants et une configuration de cycle de vie.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Nom d'acteur unique |
| setup | `function` | Fonction de setup pour initialiser l'acteur |

**Retourne:** `ActorDef` — définition d'acteur pour génération.

**Exemple:**
```ts
const Player = defineActor('Player', (setup) => {
  useComponent(Transform);
  useComponent(Health);
  
  onAdd((entity) => {
    console.log('Player spawned');
  });
});
```

### useActor(ActorDef)

**Signature:**
```ts
function useActor(def: ActorDef): void
```

**Description.** Enregistre un acteur pour utilisation au sein d'un autre acteur (composition).

**Retourne:** `void`

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

### definePrefab(options)

**Signature:**
```ts
function definePrefab(options: {
  name: string;
  components: ComponentDef[];
  defaults?: Record<string, any>;
}): PrefabDef
```

**Description.** Définit un modèle d'entité réutilisable (prefab) avec des composants prédéfinis et des valeurs par défaut.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options.name | `string` | Nom de prefab unique |
| options.components | `ComponentDef[]` | Composants à inclure |
| options.defaults | `object` | Valeurs de propriétés de composants par défaut |

**Retourne:** `PrefabDef` — définition de prefab.

**Exemple:**
```ts
const BulletPrefab = definePrefab({
  name: 'Bullet',
  components: [Transform, Velocity],
  defaults: {
    transform: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 }
  }
});
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

### defineEvents(map)

**Signature:**
```ts
function defineEvents(map: Record<string, any>): EventDef
```

**Description.** Définit les types d'événements pour votre jeu.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| map | `object` | Définitions de types d'événements |

**Retourne:** `EventDef`

**Exemple:**
```ts
const Events = defineEvents({
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
