---
title: "@gwenjs/schema"
description: "Référence API pour @gwenjs/schema."
---

# @gwenjs/schema

`pnpm add @gwenjs/schema`

Définitions de types partagées et utilitaires de configuration pour GWEN. Principalement utilisé en interne et par les auteurs de plugins. Fournit des types unifiés pour les composants, systèmes, hooks et la configuration du moteur.

## Définitions de type

### GwenHookHandler

**Signature:**
```ts
type GwenHookHandler<T = any> = (context: T) => void | Promise<void>
```

**Description.** Type de fonction gestionnaire pour les hooks de cycle de vie.

### GwenModuleEntry

**Signature:**
```ts
interface GwenModuleEntry {
  name: string;
  exports: Record<string, string>;
  hooks?: Record<string, GwenHookHandler>;
}
```

**Description.** Représente une entrée dans le registre des modules.

### GwenOptions

**Signature:**
```ts
interface GwenOptions {
  engine: {
    maxEntities: number;
    targetFPS: number;
    debug: boolean;
    enableStats: boolean;
    sparseTransformSync: boolean;
    loop: "internal" | "external";
    maxDeltaSeconds: number;
  };
  html: {
    title: string;
    background: string;
  };
  modules: GwenModuleEntry[];
  plugins: GwenPluginBase[];
  scenes: string[];
  scenesMode: "auto" | false;
  mainScene?: string;
  rootDir?: string;
  srcDir: string;
  outDir: string;
  dev?: boolean;
}
```

**Description.** Configuration moteur résolue. Les champs optionnels peuvent être absents. Les autres reçoivent une valeur par défaut.

### GwenConfigInput

**Signature:**
```ts
interface GwenConfigInput extends DeepPartial<GwenOptions> {
  plugins?: GwenPluginBase[];
  tsPlugins?: GwenPluginBase[];
  wasmPlugins?: GwenPluginBase[];
}
```

**Description.** Configuration partielle. Elle étend `DeepPartial<GwenOptions>` et accepte encore les listes de plugins legacy.

| Propriété | Type | Description |
|---|---|---|
| `plugins` | `GwenPluginBase[]` | Tableau de plugins legacy. Préférez `modules`. |
| `tsPlugins` | `GwenPluginBase[]` | Liste legacy de plugins TypeScript. |
| `wasmPlugins` | `GwenPluginBase[]` | Liste legacy de plugins WASM. |

Chaque champ de `GwenOptions` est aussi accepté, et tous sont optionnels.

### DeepPartial\<T\>

**Signature:**
```ts
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
}
```

**Description.** Rend récursivement toutes les propriétés optionnelles.

### EngineAPI

**Signature:**
```ts
interface EngineAPI {
  name: string;
  version: string;
  deltaTime: number;
  isRunning: boolean;
  start(): void;
  stop(): void;
  update(dt: number): void;
  render(): void;
}
```

**Description.** Interface d'exécution du moteur principal.

## Fonctions de configuration

### defaultOptions()

**Signature:**
```ts
function defaultOptions(): GwenOptions
```

**Description.** Retourne les options GWEN par défaut.

**Retourne:** `GwenOptions` — objet de configuration par défaut.

**Exemple:**
```ts
const defaults = defaultOptions();
```

### resolveConfig(input)

**Signature:**
```ts
function resolveConfig(input: GwenConfigInput): ResolvedGwenConfig
```

**Description.** Résout et fusionne la config utilisateur avec les defaults.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| input | `GwenConfigInput` | Configuration fournie par l'utilisateur |

**Retourne:** `ResolvedGwenConfig` — configuration entièrement résolue.

**Exemple:**
```ts
const config = resolveConfig({
  modules: ['@gwenjs/physics2d'],
  mainScene: 'game',
});
```

### validateResolvedConfig(config)

**Signature:**
```ts
function validateResolvedConfig(config: ResolvedGwenConfig): boolean
```

**Description.** Valide une configuration résolue pour sa correctness.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| config | `ResolvedGwenConfig` | Configuration à valider |

**Retourne:** `boolean` — true si valide, lève une erreur sinon.

**Exemple:**
```ts
try {
  validateResolvedConfig(myConfig);
  console.log('Config is valid');
} catch (error) {
  console.error('Invalid config:', error);
}
```

### assertModuleFirstInput(input)

**Signature:**
```ts
function assertModuleFirstInput(input: GwenConfigInput): void
```

**Description.** Lève une erreur si `plugins`, `tsPlugins` ou `wasmPlugins` sont déclarés alors que `modules` est vide. Le type de retour est `void`. Ce n'est pas un type guard.

**Exemple:**
```ts
assertModuleFirstInput(input);
```

## Hooks de cycle de vie

### EngineLifecycleHooks

**Signature:**
```ts
interface EngineLifecycleHooks {
  'engine:init': GwenHookHandler;
  'engine:start': GwenHookHandler;
  'engine:stop': GwenHookHandler;
  'engine:update': GwenHookHandler<{ dt: number }>;
  'engine:render': GwenHookHandler;
}
```

**Description.** Hooks de cycle de vie du moteur pour les plugins.

### PluginLifecycleHooks

**Signature:**
```ts
interface PluginLifecycleHooks {
  'plugin:load': GwenHookHandler;
  'plugin:setup': GwenHookHandler;
  'plugin:unload': GwenHookHandler;
}
```

**Description.** Hooks de cycle de vie des plugins.

### EntityLifecycleHooks

**Signature:**
```ts
interface EntityLifecycleHooks {
  'entity:create': GwenHookHandler<{ entity: Entity }>;
  'entity:destroy': GwenHookHandler<{ entity: Entity }>;
}
```

**Description.** Hooks de cycle de vie des entités.

### ComponentLifecycleHooks

**Signature:**
```ts
interface ComponentLifecycleHooks<EntityId = unknown> {
  'component:add': (id: EntityId, type: string, data: unknown) => void;
  'component:remove': (id: EntityId, type: string) => void;
  'component:removed': (id: EntityId, type: string) => void;
  'component:update': (id: EntityId, type: string, data: unknown) => void;
}
```

**Description.** Hooks de cycle de vie des composants.

### SceneLifecycleHooks

**Signature:**
```ts
interface SceneLifecycleHooks {
  'scene:enter': GwenHookHandler<{ scene: string }>;
  'scene:exit': GwenHookHandler<{ scene: string }>;
}
```

**Description.** Hooks de cycle de vie des scènes.
