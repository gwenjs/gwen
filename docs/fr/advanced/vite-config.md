---
title: Étendre Vite
description: Comment étendre la configuration Vite de GWEN sans fichier vite.config.ts.
---

# Étendre Vite

GWEN gère votre configuration Vite en interne via `@gwenjs/vite`. Vous n'avez pas besoin d'un fichier `vite.config.ts`. Étendez plutôt Vite via `gwen.config.ts`.

## Surcharges simples

Utilisez le champ `vite` pour des fusions directes de configuration :

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
    server: {
      port: 3000,
    },
  },
})
```

L'objet `vite` est fusionné avec la configuration interne de GWEN via `defu` (les valeurs utilisateur ont la priorité).

## Build hooks

Pour plus de contrôle, abonnez-vous au build hook `vite:extendConfig` :

```typescript
// gwen.config.ts
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = {
        ...config.resolve.alias,
        '~assets': './src/assets',
      }
    },
  },
})
```

Utilisez `vite` pour la configuration statique. Utilisez `hooks['vite:extendConfig']` lorsque vous avez besoin d'une configuration conditionnelle ou programmatique.

## Depuis un module

Si vous créez un [module GWEN](/fr/kit/custom-module), utilisez `gwen.extendViteConfig()` et `gwen.addVitePlugin()` :

```typescript
import { defineGwenModule } from '@gwenjs/kit'

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
