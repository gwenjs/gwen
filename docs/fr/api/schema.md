---
title: "@gwenjs/schema"
description: "Référence API pour @gwenjs/schema."
---

# @gwenjs/schema

`pnpm add @gwenjs/schema`

Définitions de types partagées et utilitaires de configuration pour GWEN. Principalement utilisé en interne et par les auteurs de plugins. Fournit des types unifiés pour les composants, systèmes, hooks et la configuration du moteur.

## Définitions de type

### GwenPluginBase

**Signature:**
```ts
interface GwenPluginBase {
  name: string;
  version?: string;
  description?: string;
}
```

**Description.** Interface de base pour tous les plugins. Doit inclure un nom et une version/description optionnelle.

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
  [key: string]: any;
}
```

**Description.** Objet d'options générique pour l'extensibilité.

### GwenConfigInput

**Signature:**
```ts
interface GwenConfigInput {
  plugins?: PluginDef[];
  scenes?: SceneDef[];
  initialScene?: string;
  wasm?: 'light' | 'physics2d' | 'physics3d';
  logger?: LoggerOptions;
  debug?: boolean;
  [key: string]: any;
}
```

**Description.** Entrée de configuration fournie par l'utilisateur pour GWEN.

| Propriété | Type | Description |
|---|---|---|
| `plugins` | `PluginDef[]` | Plugins à charger |
| `scenes` | `SceneDef[]` | Scènes disponibles |
| `initialScene` | `string` | Nom de la scène initiale |
| `wasm` | `string` | Variante WASM |
| `logger` | `LoggerOptions` | Configuration du journal |
| `debug` | `boolean` | Mode de débogage |

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
  scenes: [GameScene],
  initialScene: 'Game'
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
function assertModuleFirstInput(input: any): asserts input is GwenModuleEntry
```

**Description.** Type guard qui affirme que l'entrée est une entrée de module valide. Lève si invalide.

**Exemple:**
```ts
assertModuleFirstInput(moduleData);
// Après cela, TypeScript sait que moduleData est GwenModuleEntry
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
interface ComponentLifecycleHooks {
  'component:add': GwenHookHandler<{ entity: Entity; component: any }>;
  'component:remove': GwenHookHandler<{ entity: Entity; component: any }>;
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
