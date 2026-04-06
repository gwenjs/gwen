---
title: Créer un module personnalisé
description: Apprenez à créer et utiliser des modules GWEN pour la configuration à la compilation.
---

# Créer un module personnalisé

Un **module** est une extension à la compilation définie en utilisant `defineGwenModule()` depuis `@gwenjs/kit`. Tandis que les plugins gèrent le comportement runtime, les modules configurent votre projet GWEN pendant le processus de compilation (`gwen dev`, `gwen build`, `gwen prepare`).

## Les bases

### Module minimal

Le module le plus simple fournit juste des métadonnées :

```ts
import { defineGwenModule } from '@gwenjs/kit'

export default defineGwenModule({
  meta: {
    name: '@my-scope/my-module',
    configKey: 'myModule',
    version: '1.0.0',
  },
  setup(options, gwen) {
    // Module setup runs during build
    console.log('Building with options:', options)
  },
})
```

### Module avec enregistrement de plugin

La plupart des modules enregistrent un ou plusieurs plugins runtime :

```ts
import { defineGwenModule, definePlugin } from '@gwenjs/kit'

const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    engine.provide('myService', {
      greet: () => 'Hello from plugin!',
    })
  },
}))

export default defineGwenModule({
  meta: { name: '@my-scope/my-module', configKey: 'myModule' },
  setup(options, gwen) {
    // Export the plugin to be registered at runtime
    gwen.addPlugin(MyPlugin())
  },
})
```

### Module avec options

Les modules peuvent accepter des options typées via la configuration :

```ts
interface MyModuleOptions {
  debug?: boolean
  apiUrl?: string
}

export default defineGwenModule<MyModuleOptions>({
  meta: {
    name: '@my-scope/my-module',
    configKey: 'myModule',
  },
  defaults: {
    debug: false,
    apiUrl: 'https://api.example.com',
  },
  setup(options, gwen) {
    console.log(`Debug mode: ${options.debug}`)
    console.log(`API URL: ${options.apiUrl}`)
  },
})
```

Enregistrez dans `gwen.config.ts` :

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: [['@my-scope/my-module', {
    debug: true,
    apiUrl: 'https://dev.api.example.com',
  }]],
})
```

## API à la compilation (GwenKit)

Le paramètre `gwen` passé à `setup()` est l'API à la compilation. Utilisez-le pour configurer les plugins, les auto-imports, les extensions Vite et les modèles de type.

### Ajouter des plugins

Enregistrez les plugins runtime à charger :

```ts
gwen.addPlugin(MyPlugin())
```

### Auto-imports

Enregistrez les composables et utilitaires qui s'auto-importent dans le code du jeu sans déclarations d'importation explicites :

```ts
gwen.addAutoImports([
  { name: 'useMyService', from: '@my-scope/my-module' },
  { name: 'MyHelper', from: '@my-scope/my-module', as: 'Helper' },
])
```

Dans le code du jeu, `useMyService` est disponible sans import :

```ts
// No import needed!
export const MySystem = defineSystem(() => {
  const service = useMyService()
  return (ctx) => { /* ... */ }
})
```

### Extensions Vite

Étendez la configuration de compilation Vite :

```ts
gwen.extendViteConfig((config) => ({
  resolve: {
    alias: {
      '~assets': '/src/assets',
    },
  },
}))
```

Ajouter un plugin Vite :

```ts
gwen.addVitePlugin({
  name: 'my-vite-plugin',
  transform(code) {
    return code.replace(/MY_CONSTANT/g, '"replaced"')
  },
})
```

### Modèles de type

Générez les fichiers de déclaration TypeScript pour l'auto-complète IDE et la vérification de type :

```ts
gwen.addTypeTemplate({
  filename: 'types/my-service.d.ts',
  getContents() {
    return `declare module '@gwenjs/core' {
      interface GwenProvides {
        myService: MyServiceAPI
      }
    }`
  },
})
```

### Augmentation de module

Ajoutez les déclarations TypeScript en ligne sans créer un fichier séparé :

```ts
gwen.addModuleAugment(`
  declare module '@gwenjs/core' {
    interface GwenProvides {
      myService: { greet(): string }
    }
  }
`)
```

## Exemple du monde réel : Module de score

Voici un module complet qui fournit un système de suivi des scores :

```ts
import { defineGwenModule, definePlugin } from '@gwenjs/kit'

interface ScoreModuleOptions {
  initialScore?: number
  maxScore?: number
}

// Runtime plugin
const ScorePlugin = definePlugin<ScoreModuleOptions>((opts = {}) => ({
  name: 'score',
  setup(engine) {
    let score = opts.initialScore ?? 0
    const maxScore = opts.maxScore ?? 999999

    engine.provide('score', {
      get: () => score,
      add: (amount: number) => {
        score = Math.min(score + amount, maxScore)
      },
      set: (value: number) => {
        score = Math.max(0, Math.min(value, maxScore))
      },
      reset: () => {
        score = opts.initialScore ?? 0
      },
    })
  },
}))

// Build-time module
export default defineGwenModule<ScoreModuleOptions>({
  meta: {
    name: '@my-scope/score',
    configKey: 'score',
  },
  defaults: {
    initialScore: 0,
    maxScore: 999999,
  },
  setup(options, gwen) {
    gwen.addPlugin(ScorePlugin(options))

    gwen.addAutoImports([
      { name: 'useScore', from: '@my-scope/score' },
    ])

    gwen.addModuleAugment(`
      declare module '@gwenjs/core' {
        interface GwenProvides {
          score: {
            get(): number
            add(amount: number): void
            set(value: number): void
            reset(): void
          }
        }
      }
    `)
  },
})
```

Utilisez le système de score dans un système de jeu :

```ts
import { defineSystem, useEngine } from '@gwenjs/core'

export const ScoreDisplaySystem = defineSystem(() => {
  const { get } = useEngine()
  const scoreService = get('score')

  return (ctx) => {
    const currentScore = scoreService.get()
    // Render score on screen
  }
})

// Or use auto-import
export const RewardSystem = defineSystem(() => {
  const score = useScore()

  return (ctx) => {
    if (playerCollectedCoin) {
      score.add(10)
    }
  }
})
```

## Hooks de compilation

Les modules peuvent s'abonner aux événements à la compilation :

```ts
gwen.hook('build:before', () => {
  console.log('Build starting...')
})

gwen.hook('module:before', (mod) => {
  console.log(`Setting up module: ${mod.meta.name}`)
})

gwen.hook('module:done', (mod) => {
  console.log(`Finished module: ${mod.meta.name}`)
})

gwen.hook('build:done', () => {
  console.log('Build complete!')
})

gwen.hook('vite:extendConfig', (config) => {
  console.log('Vite config was extended')
})
```

## Module dans le projet

Enregistrez le module dans `gwen.config.ts` :

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: [['@my-scope/score', {
    initialScore: 0,
    maxScore: 9999,
  }]],
})
```

## Résumé de l'API

### defineGwenModule

Créez un module à la compilation :

```ts
export default defineGwenModule<Options>({
  meta: {
    name: string
    configKey?: string
    version?: string
  }
  defaults?: DeepPartial<Options>
  setup(options: Options, gwen: GwenKit): void | Promise<void>
})
```

### Méthodes GwenKit

| Méthode | But |
|---------|-----|
| `addPlugin(plugin)` | Enregistrez un plugin runtime |
| `addAutoImports(imports)` | Déclarez les utilitaires auto-importés |
| `addVitePlugin(plugin)` | Ajoutez un plugin Vite à la compilation |
| `extendViteConfig(extender)` | Étendez la configuration Vite |
| `addTypeTemplate(template)` | Générez les fichiers `.d.ts` |
| `addModuleAugment(snippet)` | Ajouter les déclarations TypeScript en ligne |
| `hook(event, fn)` | S'abonner aux événements à la compilation |
| `options` (propriété) | Accédez aux options de configuration résolues |

### AutoImport

```ts
interface AutoImport {
  name: string          // Export name from the module
  from: string          // NPM package or path
  as?: string           // Override name in auto-import
}
```

### GwenTypeTemplate

```ts
interface GwenTypeTemplate {
  filename: string      // Path inside `.gwen/`, e.g. 'types/my-service.d.ts'
  getContents(): string // Content factory called during `gwen prepare`
}
```
