---
title: Étendre Vite
description: Comment étendre la configuration Vite de GWEN sans fichier vite.config.ts.
---

# Étendre Vite

GWEN gère votre configuration Vite en interne via `@gwenjs/vite`. Vous n'avez pas besoin d'un fichier `vite.config.ts`. Étendez plutôt Vite via `gwen.config.ts`.

## CSS global

Utilisez le champ `globalCss` pour injecter des fichiers CSS dans chaque page. Les chemins sont **relatifs à la racine du projet** (là où se trouve `gwen.config.ts`) :

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  globalCss: ['./src/styles/reset.css', './src/styles/global.css'],
})
```

Ces fichiers sont injectés comme des instructions `import` statiques dans le module d'entrée virtuel, donc Vite les traite via son pipeline CSS normal (PostCSS, CSS Modules, etc.).

## Depuis un module

Si vous créez un [module GWEN](/fr/kit/custom-module), utilisez `gwen.extendViteConfig()` et `gwen.addVitePlugin()` :

```typescript
import { defineGwenModule } from '@gwenjs/kit/module'

export default defineGwenModule({
  meta: { name: '@my-scope/gwen-assets' },
  setup(options, gwen) {
    gwen.extendViteConfig(config => ({
      resolve: {
        alias: { '~assets': './src/assets' },
      },
    }))

    gwen.addVitePlugin(myVitePlugin())
  },
})
```

Les plugins ajoutés via `gwen.addVitePlugin()` sont insérés **avant** le tableau `vite.plugins` de l'utilisateur.
