---
title: "@gwenjs/kit"
description: "Référence API pour @gwenjs/kit."
---

# @gwenjs/kit

`pnpm add @gwenjs/kit`

Système de plugins et de modules pour étendre GWEN. Fournit des utilitaires pour créer des modules réutilisables, des auto-imports et des intégrations au moment du build.

## Définition de plugins

### definePlugin(factory)

**Signature:**
```ts
function definePlugin<T = any>(
  factory: (opts?: T) => PluginDef | ((opts?: T) => PluginDef)
): PluginFactory<T>
```

**Description.** Définit un plugin qui peut être chargé dans une app GWEN. La fabrique peut retourner un `PluginDef` directement ou une fonction qui retourne un `PluginDef`.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| factory | `function` | Fonction de fabrique de plugin ou définition |

**Retourne:** `PluginFactory<T>` — une fabrique de plugin prête à enregistrer.

**Exemple:**
```ts
export const MyPlugin = definePlugin((opts = {}) => ({
  name: 'my-plugin',
  version: '1.0.0',
  async setup(engine) {
    console.log('MyPlugin loaded');
  }
}));

// Dans votre configuration d'app:
defineConfig({
  plugins: [MyPlugin()],
  // ...
});
```

## Définition de modules

### defineGwenModule(name, api)

**Signature:**
```ts
function defineGwenModule(name: string, api: GwenModuleDefinition): GwenModule
```

**Description.** Définit un module GWEN pour les auto-imports au moment du build et la résolution de modules.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| name | `string` | Identifiant du module (par ex., `@gwenjs/math`) |
| api | `GwenModuleDefinition` | Définition du module avec exports et hooks |

**Retourne:** `GwenModule` — module enregistré.

**Exemple:**
```ts
defineGwenModule('@my-org/helpers', {
  exports: {
    'useHelper': './helper.ts',
    'useAnother': './another.ts'
  },
  hooks: {
    'app:config': (config) => {
      console.log('Helpers module loaded');
    }
  }
});
```

## Types

### GwenModule

**Signature:**
```ts
interface GwenModule {
  name: string;
  exports: Record<string, string>;
  hooks?: Record<string, any>;
}
```

**Description.** Représente un module GWEN enregistré avec des exports et des hooks.

### GwenModuleDefinition

**Signature:**
```ts
interface GwenModuleDefinition {
  exports: Record<string, string>;
  hooks?: GwenBuildHooks;
  auto?: AutoImport[];
}
```

**Description.** Définition d'un module GWEN pour les auto-imports et l'intégration du système de build.

| Propriété | Type | Description |
|---|---|---|
| `exports` | `object` | Carte des noms d'exports aux chemins de fichiers |
| `hooks` | `GwenBuildHooks` | Hooks de build à enregistrer |
| `auto` | `AutoImport[]` | Règles d'auto-import (optionnel) |

### GwenKit

**Signature:**
```ts
interface GwenKit {
  modules: Map<string, GwenModule>;
  plugins: Map<string, PluginDef>;
  registerModule(module: GwenModule): void;
  registerPlugin(plugin: PluginDef): void;
}
```

**Description.** Registre du kit gérant tous les modules et plugins.

### GwenBuildHooks

**Signature:**
```ts
interface GwenBuildHooks {
  'app:config': Hook<(config: ResolvedGwenConfig) => void | Promise<void>>;
  'app:resolved': Hook<(config: ResolvedGwenConfig) => void | Promise<void>>;
  'module:register': Hook<(module: GwenModule) => void | Promise<void>>;
  'plugin:setup': Hook<(plugin: PluginDef) => void | Promise<void>>;
}
```

**Description.** Hooks de build disponibles pour les plugins et modules.

### AutoImport

**Signature:**
```ts
interface AutoImport {
  name: string;
  from: string;
  imports?: string[];
}
```

**Description.** Règle d'auto-import pour les fonctionnalités d'auto-import du système de build.

| Propriété | Type | Description |
|---|---|---|
| `name` | `string` | Nom d'export |
| `from` | `string` | Chemin du module à importer depuis |
| `imports` | `string[]` | Imports spécifiques à inclure (optionnel) |

**Exemple:**
```ts
const autoImports: AutoImport[] = [
  { name: 'useQuery', from: '@gwenjs/core' },
  { name: 'defineSystem', from: '@gwenjs/core' }
];
```

### GwenTypeTemplate

**Signature:**
```ts
interface GwenTypeTemplate {
  name: string;
  path: string;
  description?: string;
}
```

**Description.** Modèle pour les définitions de type qui peuvent être générées automatiquement lors du build.
