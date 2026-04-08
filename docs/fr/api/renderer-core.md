---
title: "@gwenjs/renderer-core"
description: "Référence API pour @gwenjs/renderer-core — contrat des plugins renderer et utilitaires."
---

# @gwenjs/renderer-core

`pnpm add @gwenjs/renderer-core`

Package de contrat pour les plugins renderer GWEN. Aucune dépendance graphique — uniquement des interfaces TypeScript, `defineRendererService`, `getOrCreateLayerManager`, des utilitaires de stats et des classes d'erreur.

## defineRendererService()

```ts
function defineRendererService<Options>(
  factory: (opts: Options) => RendererServiceDef
): (opts: Options) => ManagedRendererService
```

Factory ergonomique pour implémenter un `RendererService`. Gère automatiquement :
- `contractVersion: RENDERER_CONTRACT_VERSION`
- Création et mise en cache des éléments DOM par layer
- `UnknownLayerError` pour les layers non déclarés
- Câblage de `setStatsCollector` — `reportFrameTime`/`reportLayer` sont des no-ops quand les stats sont désactivées

```ts
export const MyRenderer = defineRendererService<{ layers: Record<string, LayerDef> }>(
  (opts) => ({
    name: 'renderer:mytech',
    layers: opts.layers,

    createElement(layerName) {
      return document.createElement('canvas')
    },

    mount({ getLayer }) {
      const canvas = getLayer('game') as HTMLCanvasElement
      // initialisation du renderer
    },

    unmount() { /* nettoyage */ },
    resize(w, h) { /* redimensionnement */ },

    flush({ reportFrameTime, reportLayer }) {
      const t = performance.now()
      // rendu
      reportFrameTime(performance.now() - t)
    },
  })
)

// Instanciation dans le plugin :
const service = MyRenderer({ layers: { game: { order: 10 } } })
```

## getOrCreateLayerManager()

```ts
function getOrCreateLayerManager(engine: GwenEngine, container: HTMLElement): LayerManager
```

Point d'entrée pour les plugins renderer. Retourne le `LayerManager` partagé pour cette instance d'engine, en le créant au premier appel. Au premier appel, il :
- Lie le manager à `engine.logger` pour que tous les avertissements transitent par le log sink de l'engine.
- Enregistre un handler `engine:tick` qui appelle `manager.beginFrame()` au début de chaque frame, maintenant les totaux de stats par frame sans aucun câblage côté plugin.

```ts
// Dans un plugin renderer :
setup(engine) {
  const manager = getOrCreateLayerManager(engine, opts.container ?? document.body)
  manager.register(service)
  engine.onStart(() => manager.mount())
  engine.onDestroy(() => manager.unregister(service.name))
}
```

L'argument `container` n'est utilisé que lors du premier appel. Les plugins suivants réutilisent l'instance existante.

## Interfaces

### RendererService

Contrat que chaque plugin renderer doit implémenter. Utiliser `defineRendererService` plutôt que l'implémenter manuellement.

```ts
interface RendererService {
  readonly name: string
  readonly contractVersion: number
  readonly layers: Record<string, LayerDef>
  mount(root: HTMLElement): void
  unmount(): void
  resize(width: number, height: number): void
  getLayerElement(layerName: string): HTMLElement
  setStatsCollector?(collector: RendererStatsCollector): void
}
```

### LayerDef

```ts
interface LayerDef {
  order: number
  coordinate?: 'world' | 'screen'
}
```

| Propriété | Description |
|---|---|
| `order` | Z-index du layer. Les layers sont triés par ordre croissant. |
| `coordinate` | `'world'` (par défaut) ou `'screen'`. Les layers screen ont `pointer-events: none`. |

### ManagedRendererService

`RendererService` complet retourné par `defineRendererService`, avec une méthode `flush()` supplémentaire à appeler depuis le hook `onRender` du plugin.

## Codes d'erreur

```ts
const RendererErrorCodes = {
  ALREADY_REGISTERED:   'RENDERER:ALREADY_REGISTERED',
  CONTRACT_VERSION:     'RENDERER:CONTRACT_VERSION',
  UNKNOWN_LAYER:        'RENDERER:UNKNOWN_LAYER',
  LAYER_ORDER_CONFLICT: 'RENDERER:LAYER_ORDER_CONFLICT',
  MISSING_LAYER:        'RENDERER:MISSING_LAYER',
}
```

| Code | Déclencheur |
|---|---|
| `ALREADY_REGISTERED` | Deux plugins avec le même `name` enregistrés |
| `CONTRACT_VERSION` | Version du contrat incompatible |
| `UNKNOWN_LAYER` | `getLayerElement()` appelé avec un layer non déclaré |
| `LAYER_ORDER_CONFLICT` | Deux layers avec le même `order` — warning uniquement |
| `MISSING_LAYER` | Layer déclaré mais élément DOM manquant |

## Stats (dev uniquement)

La collecte de stats est désactivée par défaut. Activée via `manager.enableStats()` (appelé par l'engine en mode dev/debug).

```ts
manager.enableStats()
manager.mount()

const stats = manager.getStats()
// stats.renderers['renderer:canvas'].frameTimeMs  — scalaire pour cette frame
// stats.totalDrawCalls                            — total de draw calls pour la frame courante
// stats.history.drawCalls[0]                      — draw calls d'une frame dans le ring buffer de 60 frames
```

## Utilitaires de test

```ts
import { runConformanceTests } from '@gwenjs/renderer-core/testing'

it('satisfait le contrat RendererService', () => {
  expect(() => runConformanceTests(myService)).not.toThrow()
})
```

`runConformanceTests` valide la forme statique du service sans appeler `mount()` ni `unmount()`. Lance une erreur descriptive à la première violation trouvée.
