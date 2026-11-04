---
title: Vue d'ensemble du système de plugins
description: GWEN est étendu à travers les plugins et les modules via @gwenjs/kit.
---

# Vue d'ensemble du système de plugins

GWEN est livré avec un cœur ECS et c'est tout. Pas de moteur de rendu, pas de gestionnaire d'entrée, pas de système audio, pas de moteur physique. Tout au-delà de l'ECS est un **plugin**—et vous ne choisissez que ce dont votre jeu a besoin. Le préchargement est un point d'extension du cœur (`onPreload`, #116) ; les chargeurs vivent dans `@gwenjs/assets`. Voir [ADR-0005](https://github.com/gwenjs/gwen/blob/v1-alpha/internals-docs/adr/0005-asset-management.md).

Le système de plugins se compose de deux mécanismes complémentaires :

1. **Plugins** — Extensions runtime qui s'accrochent au cycle de vie du moteur
2. **Modules** — Extensions à la compilation qui configurent le projet GWEN

Ensemble, ils vous permettent d'étendre GWEN avec des capacités personnalisées ou tierces.

## Plugins vs Modules

| Aspect | Plugin | Module |
|--------|--------|--------|
| Défini avec | `definePlugin()` depuis `@gwenjs/kit` | `defineGwenModule()` depuis `@gwenjs/kit/module` |
| Enregistré dans | `src/plugins/` (auto-découvert) ou `gwen.addPlugin()` dans un module | `src/modules/` (auto-découvert) ou clé `modules` dans `gwen.config.ts` |
| Contexte d'exécution | Runtime (navigateur) | Compile-time (Node.js: `gwen dev`, `gwen build`, `gwen prepare`) |
| Portée | Cycle de vie moteur | Configuration des fonctionnalités, génération de code |
| Exemple | Gestion des entrées, simulation physique | Enregistrement de plugins, auto-imports, extensions Vite |
| Accès | Instance du `engine` passée à `setup()` | API de compilation `gwen` passée à `setup()` |

## Exemple rapide

### Plugin

Un plugin simple qui écoute les événements clavier :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (k: string) => boolean }
  }
}

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
Cette forme avec export nommé est utilisée quand un module enregistre le plugin via `gwen.addPlugin({ src: "@my-scope/input", export: "InputPlugin" })`. Pour l'auto-découverte via `src/plugins/`, utilisez `export default definePlugin(...)` à la place — voir [Enregistrer dans le projet](#enregistrer-dans-le-projet) ci-dessous.
:::

### Module

Un module qui configure le plugin Input et les auto-imports :

```ts
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: { name: '@my-scope/input', configKey: 'input' },
  setup(options, gwen) {
    gwen.addPlugin({ src: "@my-scope/input", export: "InputPlugin" })
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

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (k: string) => boolean }
  }
}

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
- Vous devez vous accrocher au cycle de vie du moteur (`setup`, hooks, `teardown`)
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

## Casts de type dans les packages GWEN

Les sources des packages GWEN (`packages/*/src`) passent quatre barrières de type dans `oxlint.json` : pas de `as X` (sauf `as const`), pas d'assertion non nulle `!`, pas de `any`, pas de directive ts-ignore, et pas de directive ts-expect-error sans description. Un cast reste seulement pour une valeur qui vient de WASM, d'un worker, de code source analysé ou d'un type tiers que TypeScript ne peut pas vérifier, ou pour un cas de générique ou de stockage hétérogène que TypeScript ne peut pas exprimer sans changer un type public (des tables par moteur qui stockent des acteurs de props différentes, par exemple), ou pour une valeur construite vide ou pré-dimensionnée puis remplie ensuite (une cible de Proxy, un tampon pré-dimensionné), ou pour un retrait que l'appelant a prouvé, quand TypeScript ne peut pas exprimer la preuve. Le fichier est alors listé dans l'override de `oxlint.json` qui désactive seulement `typescript/consistent-type-assertions`, et le cast porte `// boundary: <raison>` sur la même ligne. De petits helpers locaux au package, dans `src/internal/unchecked.ts`, portent les casts que l'appelant prouve : une lecture indexée dans une borne de boucle, un `pop()` sur un tableau non vide, un `Map.get()` sur une clé présente, un cast de marque, une table d'exports WASM. Un `setup()` de plugin qui a besoin du moteur complet appelle `asFullEngine(engine)` depuis `@gwenjs/core/internal`. Les auteurs de plugins peuvent suivre la même règle : typez la valeur quand vous le pouvez, et marquez la frontière quand vous ne le pouvez pas.

## Prochaines étapes

- [Créer un plugin personnalisé](/fr/kit/custom-plugin) — Apprenez à créer des plugins runtime
- [Créer un module personnalisé](/fr/kit/custom-module) — Apprenez à créer des modules à la compilation
- [Composer des plugins](/fr/kit/composing) — Combinez les plugins avec des dépendances
