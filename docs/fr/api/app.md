---
title: "@gwenjs/app"
description: "Référence API pour @gwenjs/app."
---

# @gwenjs/app

`pnpm add @gwenjs/app`

Configuration d'app haut niveau et système de modules pour les projets GWEN. S'intègre avec le système de build et l'écosystème des plugins.

## Configuration

### defineConfig(input)

**Signature:**
```ts
function defineConfig(input: GwenConfigInput): GwenUserConfig
```

**Description.** Définit la configuration GWEN de haut niveau. Utilisé dans votre fichier de configuration d'app (typiquement `gwen.config.ts`).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| input | `GwenConfigInput` | Objet de configuration |

**Retourne:** `GwenUserConfig` — configuration validée.

**Exemple:**
```ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    variant: 'physics2d',
  },
})
```

## Options de configuration

### GwenUserConfig

**Propriétés:**

| Propriété | Type | Description |
|---|---|---|
| `modules` | `GwenModuleEntry[]` | Liste des modules à activer (par ex., `['@gwenjs/physics2d']` ou `[['@gwenjs/input', { gamepad: true }]]`) |
| `engine.maxEntities` | `number` | Max d'entités simultanées (défaut 10_000) |
| `engine.targetFPS` | `number` | FPS cible (défaut 60) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | Variante WASM à charger |
| `engine.loop` | `'internal' \| 'external'` | Propriétaire de la boucle de jeu (défaut 'internal') |
| `engine.maxDeltaSeconds` | `number` | Max delta time par frame (défaut 0.1s) |
| `vite` | `Record<string, unknown>` | Extension de configuration Vite directe |
| `hooks` | `Partial<GwenBuildHooks>` | Abonnements aux hooks de build |
| `plugins` | `GwenPlugin[]` | Plugins à enregistrer directement (échappatoire) |

**Exemple:**
```ts
const config: GwenUserConfig = {
  modules: [
    '@gwenjs/physics2d',
    ['@gwenjs/input', { gamepad: true }],
  ],
  engine: {
    maxEntities: 5_000,
    targetFPS: 60,
    variant: 'physics2d',
  },
}
```

### ResolvedGwenConfig

**Signature:**
```ts
interface ResolvedGwenConfig extends GwenUserConfig {
  // Identique à GwenUserConfig mais avec tous les defaults appliqués
}
```

**Description.** Configuration entièrement résolue avec tous les defaults appliqués. Utilisée en interne.

### GwenModuleOptions

**Signature:**
```ts
interface GwenModuleOptions {
  name: string;
  version?: string;
  auto?: AutoImport[];
  [key: string]: any;
}
```

**Description.** Options pour un module GWEN enregistré dans le système de build.

| Propriété | Type | Description |
|---|---|---|
| `name` | `string` | Identifiant du module |
| `version` | `string` | Version du module (optionnel) |
| `auto` | `AutoImport[]` | Règles d'auto-import pour le build |

### GwenBuildHooks

**Signature:**
```ts
interface GwenBuildHooks {
  'app:config': Hook<(config: ResolvedGwenConfig) => void>;
  'app:resolved': Hook<(config: ResolvedGwenConfig) => void>;
  // Hooks de build additionnels
}
```

**Description.** Hooks de build pour l'initialisation d'app et la résolution de configuration.

**Exemple:**
```ts
const plugin: PluginDef = {
  name: 'my-plugin',
  hooks: {
    'app:config': (config) => {
      console.log('App config resolved:', config);
    }
  }
};
```
