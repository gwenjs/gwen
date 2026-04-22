---
title: Vue d'ensemble du système de plugins
description: GWEN est étendu à travers les plugins et les modules via @gwenjs/kit.
---

# Vue d'ensemble du système de plugins

GWEN est livré avec un cœur ECS et c'est tout. Pas de moteur de rendu, pas de gestionnaire d'entrée, pas de système audio, pas de moteur physique. Tout au-delà de l'ECS est un **plugin**—et vous ne choisissez que ce dont votre jeu a besoin.

Le système de plugins se compose de deux mécanismes complémentaires :

1. **Plugins** — Extensions runtime qui s'accrochent au cycle de vie du moteur
2. **Modules** — Extensions à la compilation qui configurent le projet GWEN

Ensemble, ils vous permettent d'étendre GWEN avec des capacités personnalisées ou tierces.

## Plugins vs Modules

| Aspect | Plugin | Module |
|--------|--------|--------|
| Défini avec | `definePlugin()` depuis `@gwenjs/kit` | `defineGwenModule()` depuis `@gwenjs/kit` |
| Enregistré dans | `src/plugins/` (auto-découvert) ou `gwen.addPlugin()` dans un module | `src/modules/` (auto-découvert) ou clé `modules` dans `gwen.config.ts` |
| Contexte d'exécution | Runtime (navigateur) | Compile-time (Node.js: `gwen dev`, `gwen build`, `gwen prepare`) |
| Portée | Cycle de vie moteur | Configuration des fonctionnalités, génération de code |
| Exemple | Gestion des entrées, simulation physique | Enregistrement de plugins, auto-imports, extensions Vite, modèles de type |
| Accès | Instance du `engine` passée à `setup()` | API de compilation `gwen` passée à `setup()` |

## Exemple rapide

### Plugin

Un plugin simple qui écoute les événements clavier :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

export const InputPlugin = definePlugin(() => ({
  name: 'input',
  setup(engine) {
    const keys = new Set<string>()

    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })

    // Store for access in systems (via services)
    engine.provide('input', { isKeyDown: (k: string) => keys.has(k) })
  },
}))
```

::: info Export nommé vs export par défaut
Cette forme avec export nommé est utilisée quand un module enregistre le plugin via `gwen.addPlugin(InputPlugin())`. Pour l'auto-découverte via `src/plugins/`, utilisez `export default definePlugin(...)` à la place — voir [Enregistrer dans le projet](#enregistrer-dans-le-projet) ci-dessous.
:::

### Module

Un module qui configure le plugin Input et les auto-imports :

```ts
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: { name: '@my-scope/input', configKey: 'input' },
  setup(options, gwen) {
    gwen.addPlugin(InputPlugin())
    gwen.addAutoImports([
      { name: 'useInput', from: '@my-scope/input' },
    ])
  },
})
```

### Enregistrer dans le projet

**Option A — Fichier local (spécifique au projet, pas de config nécessaire) :**

Déposez un fichier dans `src/plugins/`. GWEN le découvre et l'enregistre automatiquement :

```ts
// src/plugins/input.ts
import { definePlugin } from '@gwenjs/kit/plugin'

export default definePlugin(() => ({
  name: 'input',
  setup(engine) {
    const keys = new Set<string>()
    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })
    engine.provide('input', { isKeyDown: (k: string) => keys.has(k) })
  },
}))
```

Les plugins locaux s'exécutent après `config.plugins` — voir [Ordre de chargement](/fr/guide/project-structure#ordre-de-chargement) pour la séquence complète.

::: tip Fichiers plats uniquement
`src/plugins/input.ts` ✅ — `src/plugins/input/index.ts` ❌. Les sous-répertoires ne sont pas scannés.
:::

**Option B — Module dans `gwen.config.ts` (packages npm ou options depuis la config) :**

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@my-scope/input'],
  input: { preventDefault: ['ArrowUp', 'ArrowDown'] },
})
```

Le package module lui-même appelle `gwen.addPlugin()` dans son `setup()`. L'entrée `gwen.config.ts` indique seulement à GWEN quel module charger.

## Quand utiliser l'un ou l'autre

**Utilisez un Plugin lorsque :**
- Vous devez vous accrocher au cycle de vie du moteur (`setup`, `onStart`, `teardown`)
- Vous voulez fournir des services runtime aux systèmes
- Vous implémentez une logique de jeu ou un rendu

**Utilisez un Module lorsque :**
- Vous devez configurer le comportement à la compilation
- Vous enregistrez plusieurs plugins ou auto-imports en tant que fonctionnalité cohérente
- Vous voulez étendre le pipeline de compilation Vite
- Vous avez besoin de générer des définitions de type pour l'auto-complétion de l'IDE

**Enregistrer un module :**
- Déposez un fichier dans `src/modules/` pour les modules locaux au projet (auto-découverts)
- Ajoutez `'@my-scope/module'` à `modules` dans `gwen.config.ts` pour les packages npm

## Prochaines étapes

- [Créer un plugin personnalisé](/fr/kit/custom-plugin) — Apprenez à créer des plugins runtime
- [Créer un module personnalisé](/fr/kit/custom-module) — Apprenez à créer des modules à la compilation
- [Composer des plugins](/fr/kit/composing) — Combinez les plugins avec des dépendances
