---
title: "@gwenjs/renderer-core"
description: "Référence API pour @gwenjs/renderer-core — contrat des plugins renderer et utilitaires."
---

# @gwenjs/renderer-core

`pnpm add @gwenjs/renderer-core`

Package de contrat pour les plugins renderer GWEN. Aucune dépendance graphique — uniquement des interfaces TypeScript, `defineRendererService`, `getOrCreateLayerManager`, des utilitaires de stats et des classes d'erreur.

## defineRendererService()

```ts
function defineRendererService<Options, TExtension extends object = {}>(
  factory: (opts: Options) => RendererServiceDef<TExtension>
): (opts: Options) => ManagedRendererService & TExtension
```

Factory ergonomique pour implémenter un `RendererService`. Gère automatiquement :
- `contractVersion: RENDERER_CONTRACT_VERSION`
- Création et mise en cache des éléments DOM par layer
- `UnknownLayerError` pour les layers non déclarés
- Câblage de `setStatsCollector` — `reportFrameTime`/`reportLayer` sont des no-ops quand les stats sont désactivées

Le generic optionnel `TExtension` permet aux plugins renderer d'exposer des méthodes supplémentaires (ex. `allocateHandle` pour les composables) sans réimplémenter le boilerplate `RendererService`.

```ts
// Usage de base — sans extension
export const MyRenderer = defineRendererService<{ layers: Record<string, LayerDef> }>(
  (opts) => ({
    name: 'renderer:mytech',
    layers: opts.layers,
    createElement(layerName) { return document.createElement('canvas') },
    mount({ getLayer }) { /* initialisation */ },
    unmount() { /* nettoyage */ },
    resize(w, h) { /* redimensionnement */ },
    flush({ reportFrameTime }) {
      const t = performance.now()
      // rendu
      reportFrameTime(performance.now() - t)
    },
  })
)

// Instanciation dans le plugin :
const service = MyRenderer({ layers: { game: { order: 10 } } })
```

```ts
// Avec extension — méthodes spécifiques au renderer typées sur le service retourné
export const HTMLRenderer = defineRendererService<
  HTMLOptions,
  { allocateHandle(layer: string, key: string): HTMLHandle }
>((opts) => {
  const layers = buildLayerMap(opts.layers)
  return {
    name: 'renderer:html',
    layers: opts.layers,
    createElement: (name) => layers.get(name)!.element,
    mount: () => {},
    unmount: () => { layers.forEach((l) => l.element.remove()) },
    resize: () => {},
    extension: {
      allocateHandle(layer, key) {
        return new HTMLHandleImpl(layers.get(layer)!, key)
      },
    },
  }
})

export type HTMLRendererService = ReturnType<typeof HTMLRenderer>
// HTMLRendererService = ManagedRendererService & { allocateHandle(...): HTMLHandle }
```

**Champs de `RendererServiceDef<TExtension>`**

| Champ | Requis | Description |
|---|---|---|
| `name` | ✅ | Identifiant unique du renderer |
| `layers` | ✅ | Déclarations de layers |
| `createElement(name)` | ✅ | Crée l'élément DOM pour un layer — résultat mis en cache |
| `mount(ctx)` | ✅ | Appelé après insertion de tous les éléments |
| `unmount()` | ✅ | Doit libérer toutes les ressources |
| `resize(w, h)` | ✅ | Appelé lors du redimensionnement du viewport |
| `flush(ctx)` | Optionnel | Appelé chaque frame via `service.flush()` |
| `extension` | Optionnel | Méthodes supplémentaires fusionnées dans le service retourné |

Les propriétés du contrat (`name`, `contractVersion`, `layers`, `getLayerElement`, `mount`, `unmount`, `resize`, `setStatsCollector`, `flush`) ont toujours la priorité sur les clés homonymes dans `extension`.

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
  engine.hooks.hook('engine:init', () => manager.mount())
  engine.hooks.hook('engine:stop', () => manager.unregister(service.name))
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
| `coordinate` | `'screen'` (par défaut) ou `'world'`. `'screen'` = positions en pixels CSS ; `'world'` = le renderer doit projeter les coordonnées monde en espace écran. |
| `scope` | `'global'` (par défaut quand `coordinate: 'screen'`) ou `'viewport'` (par défaut quand `coordinate: 'world'`). `'viewport'` = le layer est instancié une fois par viewport et reçoit la transformation caméra correspondante. `'global'` = le layer est monté une fois pour tout l'écran (ex. HUD). |

### ManagedRendererService

`RendererService` complet retourné par `defineRendererService`, avec une méthode `flush()` supplémentaire à appeler depuis le hook `onRender` du plugin.

## Caméra et viewports

Ces types, interfaces et composables sont partagés entre les plugins renderer et les systèmes qui ont besoin de la caméra. Les plugins renderer lisent `CameraState` à chaque frame pour projeter le monde ; le code de jeu écrit des `ViewportRegion` pour déclarer les régions d'écran.

### Types

#### `ViewportRegion`

```ts
interface ViewportRegion {
  x: number       // bord gauche [0–1]
  y: number       // bord haut   [0–1]
  width: number   // [0–1]
  height: number  // [0–1]
}
```

Région d'écran normalisée. `{ x: 0, y: 0, width: 1, height: 1 }` = plein écran,
`{ x: 0, y: 0, width: 0.5, height: 1 }` = moitié gauche.

#### `ViewportContext`

```ts
interface ViewportContext {
  id: string              // ex. 'main', 'p1', 'minimap'
  region: ViewportRegion
}
```

Un viewport enregistré — son id et sa région d'écran courante. Retourné par
`ViewportManager.get()` et `ViewportManager.getAll()`.

#### `WorldTransform`

```ts
interface WorldTransform {
  position: Vec3   // position dans l'espace monde
  rotation: Vec3   // angles d'Euler en radians. Caméras 2D : seul z est utilisé.
}
```

Position et orientation d'une caméra dans l'espace monde.

#### `CameraProjection`

```ts
type CameraProjection =
  | { type: 'orthographic'; zoom: number; near: number; far: number }
  | { type: 'perspective';  fov: number;  near: number; far: number }
```

Comment le monde est projeté sur l'écran. `aspect` est toujours dérivé des dimensions
pixel du viewport au moment du rendu — jamais stocké ici.

| Champ | Orthographique | Perspective |
|---|---|---|
| `zoom` | Unités monde par pixel — `1` = 1 unité/px | — |
| `fov` | — | FOV vertical en radians |
| `near` | Plan de découpe proche (défaut `-1`) | Plan de découpe proche (défaut `0.1`) |
| `far` | Plan de découpe loin (défaut `1`) | Plan de découpe loin (défaut `1000`) |

#### `CameraState`

```ts
interface CameraState {
  worldTransform: WorldTransform
  projection: CameraProjection
  viewportId: string   // viewport auquel cette caméra est liée
  active: boolean
  priority: number     // la plus haute priorité gagne quand plusieurs caméras ciblent le même viewport
}
```

L'état complet de la caméra pour un viewport. Écrit par `CameraSystem` (camera-core)
au début de chaque frame et lu par les plugins renderer.

---

### `ViewportManager`

Registre des régions d'écran nommées. Émet des hooks engine quand des viewports sont ajoutés,
redimensionnés ou supprimés.

```ts
interface ViewportManager {
  set(id: string, region: ViewportRegion): void
  remove(id: string): void
  get(id: string): ViewportContext | undefined
  getAll(): ReadonlyMap<string, ViewportContext>
}
```

| Méthode | Description |
|---|---|
| `set(id, region)` | Enregistre ou met à jour un viewport. Émet `viewport:add` au premier appel, `viewport:resize` lors d'une mise à jour. |
| `remove(id)` | Supprime un viewport. Émet `viewport:remove`. No-op pour les ids inconnus. |
| `get(id)` | Lit le contexte d'un viewport, ou `undefined` s'il n'est pas enregistré. |
| `getAll()` | Tous les viewports enregistrés. La map retournée est live — ne pas muter. |

#### `useViewportManager()`

```ts
function useViewportManager(): ViewportManager
```

Composable pour accéder au `ViewportManager` partagé. À appeler dans `defineSystem`,
`defineActor`, ou les fonctions de setup `defineScene`.

Requiert que `CameraCorePlugin` (de `@gwenjs/camera-core`) soit installé.

```ts
import { useViewportManager } from '@gwenjs/renderer-core'
import { defineSystem } from '@gwenjs/core/system'

const ViewportSetupSystem = defineSystem('ViewportSetupSystem', () => {
  const viewports = useViewportManager()
  // plein écran
  viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })
})

// Exemple split-screen dynamique
const SplitScreenSystem = defineSystem('SplitScreenSystem', () => {
  const viewports = useViewportManager()
  onUpdate(() => {
    if (player2Joined) {
      viewports.set('p1', { x: 0,   y: 0, width: 0.5, height: 1 })
      viewports.set('p2', { x: 0.5, y: 0, width: 0.5, height: 1 })
      viewports.remove('main')
    }
  })
})
```

#### `getOrCreateViewportManager(engine)`

```ts
function getOrCreateViewportManager(engine: GwenEngine): ViewportManager
```

Factory niveau plugin. Retourne le `ViewportManager` partagé pour cette instance d'engine,
en le créant au premier appel et en l'enregistrant via `engine.provide('viewportManager', …)`.

À utiliser dans `setup(engine)` d'un `definePlugin` — pas dans les systèmes ou acteurs.

```ts
import { getOrCreateViewportManager } from '@gwenjs/renderer-core'
import { definePlugin } from '@gwenjs/kit/plugin'

export const MyRendererPlugin = definePlugin<{ container: HTMLElement }>((opts) => ({
  name: 'renderer:my',
  setup(engine) {
    const viewports = getOrCreateViewportManager(engine)
    viewports.set('main', { x: 0, y: 0, width: 1, height: 1 })
  },
}))
```

#### Hooks viewport

Déclarés sur `GwenRuntimeHooks` par `@gwenjs/renderer-core` :

| Hook | Payload | Quand |
|---|---|---|
| `viewport:add` | `{ id: string, region: ViewportRegion }` | Nouveau viewport enregistré |
| `viewport:resize` | `{ id: string, region: ViewportRegion }` | Région d'un viewport existant mise à jour |
| `viewport:remove` | `{ id: string }` | Viewport supprimé |

```ts
engine.hooks.hook('viewport:add', ({ id, region }) => {
  console.log(`viewport "${id}" ajouté`, region)
})
```

---

### `CameraManager`

Store d'état caméra par frame. Écrit par `CameraSystem` au début de chaque frame ;
lu par les plugins renderer pendant le rendu.

```ts
interface CameraManager {
  set(viewportId: string, state: CameraState): void
  get(viewportId: string): CameraState | undefined
  getAll(): ReadonlyMap<string, CameraState>
  clearFrame(): void
}
```

| Méthode | Description |
|---|---|
| `set(viewportId, state)` | Écrit l'état caméra. Ignoré si un état existant a une priorité strictement supérieure. |
| `get(viewportId)` | Lit l'état actif de la caméra pour un viewport, ou `undefined` si aucun. |
| `getAll()` | Tous les états courants. Map live — ne pas muter. |
| `clearFrame()` | Efface tous les états. Appelé par `CameraSystem` avant d'écrire les nouveaux états. |

#### `useCameraManager()`

```ts
function useCameraManager(): CameraManager
```

Composable pour accéder au `CameraManager` partagé. À appeler dans `defineSystem`,
`defineActor`, ou les fonctions de setup `defineScene`.

Requiert que `CameraCorePlugin` (de `@gwenjs/camera-core`) soit installé.

```ts
import { useCameraManager } from '@gwenjs/renderer-core'
import { defineSystem, onRender } from '@gwenjs/core/system'

const MyRenderSystem = defineSystem('MyRenderSystem', () => {
  const cameras = useCameraManager()
  onRender(() => {
    const state = cameras.get('main')
    if (state?.active) {
      const { position, rotation } = state.worldTransform
      // appliquer au renderer…
    }
  })
})
```

#### `getOrCreateCameraManager(engine)`

```ts
function getOrCreateCameraManager(engine: GwenEngine): CameraManager
```

Factory niveau plugin. Retourne le `CameraManager` partagé pour cette instance d'engine,
en le créant au premier appel et en l'enregistrant via `engine.provide('cameraManager', …)`.

À utiliser dans `setup(engine)` d'un `definePlugin` — pas dans les systèmes ou acteurs.

```ts
import { getOrCreateCameraManager } from '@gwenjs/renderer-core'

setup(engine) {
  const cameras = getOrCreateCameraManager(engine)
  // cameras est maintenant accessible via useCameraManager() dans les systèmes/acteurs
}
```

---

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
