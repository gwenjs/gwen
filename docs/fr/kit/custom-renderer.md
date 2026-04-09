---
title: Créer un renderer personnalisé
description: Comment créer un plugin renderer GWEN qui s'intègre avec getOrCreateLayerManager, expose des composables et passe la suite de conformité.
---

# Créer un renderer personnalisé

Ce guide explique comment construire un plugin renderer complet pour GWEN — de la création du package jusqu'à l'exposition de composables et la validation de la conformité.

## Qu'est-ce qu'un plugin renderer ?

Un plugin renderer connecte une technologie graphique (Canvas, WebGL, Three.js, un moteur 2D personnalisé…) à l'engine GWEN. Il :

- Utilise `defineRendererService` depuis `@gwenjs/renderer-core`
- S'enregistre via `engine.provide('renderer:<nom>', service)`
- Gère un ou plusieurs layers DOM nommés (chacun un `<canvas>` ou un `<div>`)
- Expose des composables (`useMonRenderer()`) que le code de jeu appelle dans `defineActor`

L'engine GWEN ne sait rien du rendu — tout ce qui est visuel est un plugin.

## Prérequis

- Lire `internals-docs/renderer-system.md` pour le contexte architectural
- `@gwenjs/renderer-core` doit être installé (il fournit le contrat)

## Étape 1 — Créer le package

Utiliser le CLI GWEN pour générer la structure du package :

```bash
pnpm dlx @gwenjs/cli scaffold package renderer-mytech
```

Cela génère la structure complète :

```
renderer-mytech/
├── package.json
├── tsconfig.json
├── vite.config.ts
└── src/
    ├── index.ts
    ├── types.ts
    ├── plugin.ts
    ├── composables.ts
    ├── augment.ts
    └── module.ts
```

Puis ajouter `@gwenjs/renderer-core` comme dépendance :

```bash
cd renderer-mytech
pnpm add @gwenjs/renderer-core
```

## Étape 2 — Implémenter le service renderer

Utiliser `defineRendererService` pour définir le service. Il gère automatiquement la version du contrat, le cache des éléments, `UnknownLayerError` et le câblage des stats.

Créer `src/mytech-renderer-service.ts` :

```ts
import { defineRendererService, type LayerDef } from '@gwenjs/renderer-core'
import { MyTechEngine } from 'mytech'

export interface MyTechRendererOptions {
  layers: Record<string, LayerDef>
}

let engine: MyTechEngine | null = null

export const MyTechRenderer = defineRendererService<MyTechRendererOptions>((opts) => ({
  name: 'renderer:mytech',
  layers: opts.layers,

  // Appelé une fois par layer déclaré — résultat mis en cache automatiquement
  createElement() {
    return document.createElement('canvas')
  },

  mount({ getLayer }) {
    const canvas = getLayer(Object.keys(opts.layers)[0]!) as HTMLCanvasElement
    engine = new MyTechEngine({ canvas })
  },

  unmount() {
    engine?.dispose()
    engine = null
  },

  resize(w, h) {
    engine?.setSize(w, h)
  },

  // Appelé chaque frame via service.flush() — stats sont des no-ops si désactivées
  flush({ reportFrameTime }) {
    const t = performance.now()
    engine?.render()
    reportFrameTime(performance.now() - t)
  },
}))
```

## Comment LayerManager orchestre le montage

`defineRendererService` crée deux surfaces d'API distinctes :

| `RendererServiceDef` (ce que vous écrivez) | `RendererService` (ce que LayerManager appelle) |
|---|---|
| `createElement(layerName): HTMLElement` | `getLayerElement(layerName): HTMLElement` |
| `mount(ctx: RendererMountContext): void` | `mount(container: HTMLElement): void` |

La séquence d'orchestration lors de l'appel à `manager.mount()` :

1. **Pour chaque layer déclaré** — LayerManager appelle `service.getLayerElement(layerName)`, ce qui déclenche votre `createElement(layerName)` au premier appel et met le résultat en cache.
2. **Insertion dans le DOM** — LayerManager insère chaque élément dans le conteneur dans l'ordre défini par `order`.
3. **Appel de mount** — LayerManager appelle `service.mount(container)`. En interne, `defineRendererService` traduit cela en `def.mount({ container, getLayer: (name) => elementCache.get(name) })`.
4. **Votre `mount({ getLayer })` s'exécute** — à ce stade, tous les éléments sont déjà dans le DOM et ont leurs dimensions finales.

::: tip Tester le service directement
Lors de tests en dehors de LayerManager, appelez `service.mount(container)` avec un `HTMLElement` — pas `{ getLayer }`. Le contexte `getLayer` est construit en interne par `defineRendererService`.

```ts
const service = MyTechRenderer({ layers: { main: { order: 0 } } })
const container = document.createElement('div')
document.body.appendChild(container)
service.mount(container) // ✅ API publique correcte
```
:::

### Exposer des méthodes renderer-spécifiques pour les composables

Certains renderers ont besoin d'exposer des méthodes d'infrastructure (ex. `allocateHandle`) que les composables appellent via `useService`. Utiliser le champ `extension` — il est fusionné dans le service retourné et typé via le second generic, sans `Object.assign` et sans réimplémenter le boilerplate.

```ts
import { defineRendererService, UnknownLayerError, type LayerDef } from '@gwenjs/renderer-core'

export interface MyTechRendererOptions {
  layers: Record<string, LayerDef>
}

export interface MyTechHandle {
  setPosition(x: number, y: number): void
  destroy(): void
}

// Le type d'extension est reflété sur ReturnType<typeof MyTechRenderer>
export const MyTechRenderer = defineRendererService<
  MyTechRendererOptions,
  { allocateHandle(layerName: string, key: string): MyTechHandle }
>((opts) => {
  // État scopé à cette instance — les méthodes d'extension ferment dessus
  const layerObjects = new Map<string, MyTechLayer>()
  for (const [name, def] of Object.entries(opts.layers)) {
    layerObjects.set(name, new MyTechLayer(name, def))
  }

  return {
    name: 'renderer:mytech',
    layers: opts.layers,
    createElement: (name) => layerObjects.get(name)!.element,
    mount: () => {},
    unmount: () => { layerObjects.forEach((l) => l.destroy()) },
    resize: () => {},

    extension: {
      allocateHandle(layerName, key) {
        const layer = layerObjects.get(layerName)
        if (!layer) throw new UnknownLayerError(layerName, 'renderer:mytech')
        return layer.allocate(key)
      },
    },
  }
})

// Exporter le type de service étendu pour que les composables puissent y caster
export type MyTechRendererService = ReturnType<typeof MyTechRenderer>
```

Dans le composable :

```ts
import { onCleanup } from '@gwenjs/core'
import { useService } from '@gwenjs/core/system'
import type { MyTechHandle, MyTechRendererService } from './mytech-renderer-service.js'

export function useMyTechObject(layerName: string, key: string): MyTechHandle {
  const service = useService('renderer:mytech') as MyTechRendererService
  const handle = service.allocateHandle(layerName, key)
  onCleanup(() => handle.destroy())
  return handle
}
```

## Étape 3 — Créer le GwenPlugin

Créer `src/mytech-plugin.ts` :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { getOrCreateLayerManager } from '@gwenjs/renderer-core'
import type { LayerDef } from '@gwenjs/renderer-core'
import { MyTechRenderer } from './mytech-renderer-service.js'

export interface MyTechRendererPluginOptions {
  layers: Record<string, LayerDef>
  container?: HTMLElement
}

export const MyTechRendererPlugin = definePlugin<MyTechRendererPluginOptions>((opts) => {
  const service = MyTechRenderer({ layers: opts.layers })

  return {
    name: 'renderer:mytech',
    setup(engine) {
      engine.provide('renderer:mytech', service)

      const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
      if (import.meta.env.DEV || engine.debug) {
        manager.enableStats()
      }
      manager.register(service)

      engine.hooks.hook('engine:init', () => manager.mount())
      engine.hooks.hook('engine:stop', () => manager.unregister('renderer:mytech'))
    },

    onRender() {
      service.flush()
    },
  }
})
```

## Étape 4 — Exposer des composables

Les composables sont l'API publique pour le code de jeu. Chaque composable :
- Récupère le service via `useService`
- Crée la ressource sur le service
- Enregistre `onDestroy` automatiquement — le game dev n'a pas à s'en occuper

Créer `src/composables/use-mytech-object.ts` :

```ts
import { onDestroy } from '@gwenjs/core/actor'
import { useService } from '@gwenjs/core/system'

export interface MyTechObjectHandle {
  setPosition(x: number, y: number): void
  setVisible(v: boolean): void
  destroy(): void
}

/**
 * Ajoute un objet MyTech renderable à l'actor courant.
 * Nettoyé automatiquement à la destruction de l'actor.
 *
 * Doit être appelé dans `defineActor()`.
 */
export function useMyTechObject(): MyTechObjectHandle {
  const service = useService('renderer:mytech')
  const obj = service.createObject()

  onDestroy(() => obj.destroy())

  return {
    setPosition: (x, y) => obj.setPosition(x, y),
    setVisible:  (v) => obj.setVisible(v),
    destroy:     () => obj.destroy(),
  }
}
```

## Étape 5 — Exporter un GwenModule

Créer `src/module.ts` :

```ts
import { defineGwenModule } from '@gwenjs/kit/module'
import { MyTechRendererPlugin } from './mytech-plugin.js'
import type { MyTechRendererPluginOptions } from './mytech-plugin.js'

export default defineGwenModule<MyTechRendererPluginOptions>({
  meta: {
    name: '@gwenjs/renderer-mytech',
    configKey: 'rendererMytech',
  },
  defaults: {
    layers: { main: { order: 0 } },
  },
  setup(options, gwen) {
    gwen.addPlugin(MyTechRendererPlugin(options))
    gwen.addAutoImports([
      { name: 'useMyTechObject', from: '@gwenjs/renderer-mytech' },
    ])
    gwen.addModuleAugment(`
      declare module '@gwenjs/core' {
        interface GwenProvides {
          'renderer:mytech': ReturnType<typeof import('@gwenjs/renderer-mytech').MyTechRenderer>
        }
      }
    `)
  },
})
```

## Étape 6 — Ajouter le test de conformité

```ts
// tests/conformance.test.ts
import { runConformanceTests } from '@gwenjs/renderer-core/testing'
import { MyTechRenderer } from '../src/mytech-renderer-service.js'

describe('@gwenjs/renderer-mytech conformité', () => {
  it('satisfait le contrat RendererService', () => {
    const service = MyTechRenderer({ layers: { main: { order: 0 } } })
    expect(() => runConformanceTests(service)).not.toThrow()
  })
})
```

## Étape 7 — Enregistrer dans `gwen.config.ts`

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: [
    ['@gwenjs/renderer-mytech', {
      layers: {
        background: { order: 0  },
        game:       { order: 10 },
      }
    }],
  ]
})
```

## Membres requis vs optionnels

| Membre RendererService | Requis | Notes |
|---|---|---|
| `name` | ✅ | Doit correspondre à la clé `GwenProvides` |
| `contractVersion` | ✅ | Géré automatiquement par `defineRendererService` |
| `layers` | ✅ | Au moins une entrée |
| `mount()` | ✅ | Appelé quand le DOM est prêt |
| `unmount()` | ✅ | Doit libérer toutes les ressources |
| `resize()` | ✅ | Appelé lors du redimensionnement du viewport |
| `getLayerElement()` | ✅ | Géré automatiquement par `defineRendererService` |
| `setStatsCollector()` | Optionnel | Géré automatiquement par `defineRendererService` |

## Checklist avant publication

- [ ] `runConformanceTests()` passe en CI
- [ ] `pnpm typecheck` passe
- [ ] Augmentation `GwenProvides` déclarée dans `index.d.ts`
- [ ] `onDestroy` / `unmount()` libère toutes les ressources (listeners, buffers GPU, nœuds DOM)
- [ ] `flush()` implémenté avec `reportFrameTime` si le renderer émet des draw calls
- [ ] README contient le snippet `gwen.config.ts`
