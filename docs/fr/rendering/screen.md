---
title: Infos Écran
description: Accédez aux dimensions pixel, au DPR et aux bornes monde de n'importe quel viewport nommé via useScreen().
---

# Infos Écran

`useScreen()` donne à votre code de jeu un accès direct aux dimensions pixel d'un viewport
et à ses bornes monde — sans dépendance à `window.*` ou aux APIs navigateur.

```ts
const screen = useScreen('main')

onUpdate(() => {
  // Contraindre le joueur aux bornes visibles
  if (screen.bounds) {
    Position.x[id] = Math.max(screen.bounds.minX, Math.min(screen.bounds.maxX, Position.x[id]))
    Position.y[id] = Math.max(screen.bounds.minY, Math.min(screen.bounds.maxY, Position.y[id]))
  }

  // Centrer un élément UI
  UIBox.x[uiId] = screen.pixels.width / 2
})
```

## Configuration zéro

`ScreenPlugin` est enregistré automatiquement par `@gwenjs/app` — aucune configuration
requise pour les jeux navigateur :

```ts
// gwen.config.ts — rien à faire
export default defineConfig({
  modules: ['@gwenjs/camera2d', '@gwenjs/renderer-html'],
})
```

Dans le navigateur, `ScreenPlugin` utilise `ResizeObserver` sur `document.documentElement`
pour détecter la taille du container. Les dimensions se mettent à jour automatiquement à
chaque redimensionnement.

## `useScreen(viewportId?)`

À appeler pendant la **phase de setup synchrone** de `defineSystem`, `defineActor` ou `defineScene`.

```ts
const screen = useScreen()        // 'main' par défaut
const screen = useScreen('main')  // id explicite
const p1     = useScreen('p1')    // split-screen joueur 1
```

L'objet retourné est **stable** — la même référence est retournée à chaque appel pour le
même id. Ses propriétés sont mutées en place chaque frame. Sûr à capturer dans des closures
et des callbacks async.

| Propriété | Type | Description | Mise à jour |
|---|---|---|---|
| `pixels.width` | `number` | Largeur du viewport en pixels CSS | Au resize |
| `pixels.height` | `number` | Hauteur du viewport en pixels CSS | Au resize |
| `dpr` | `number` | Ratio de pixels de l'appareil | Au resize |
| `bounds` | `ViewportBounds \| undefined` | Bornes monde | Chaque frame (plugin caméra) |

## Bornes monde

`bounds` est alimenté par le plugin caméra actif chaque frame dans `engine:afterTick` (après
que `CameraSystem` a écrit l'état caméra).

```ts
interface ViewportBounds {
  minX: number
  maxX: number
  minY: number
  maxY: number
}
```

| Scénario | Valeur de `bounds` |
|---|---|
| Caméra orthographique active (via `camera-core`) | Calculé depuis le zoom + la position caméra |
| Aucun plugin caméra installé | `undefined` |
| Aucune caméra active pour ce viewport | `undefined` |
| Caméra perspective (non encore supporté) | `undefined` |

## Split-screen

Chaque viewport obtient sa propre instance `useScreen()` avec des dimensions et des bornes indépendantes :

```ts
// gwen.config.ts
export default defineConfig({
  viewports: {
    p1: { x: 0,   y: 0, width: 0.5, height: 1 },
    p2: { x: 0.5, y: 0, width: 0.5, height: 1 },
  },
})

// Dans un système
const Player1System = defineSystem('Player1System', () => {
  const screen = useScreen('p1')

  onUpdate(() => {
    if (screen.bounds) {
      Position.x[p1Id] = Math.max(screen.bounds.minX, Position.x[p1Id])
    }
  })
})
```

## Node.js / serveur

Pour les serveurs de jeu ou les environnements non-navigateur, fournissez un `StaticSizeProvider` :

```ts
// gwen.config.ts
import { StaticSizeProvider } from '@gwenjs/renderer-core'

export default defineConfig({
  screen: {
    sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 })
  }
})
```

Les bornes monde sont toujours calculées si un plugin caméra est installé.

## Environnement personnalisé

Pour Electron, les WebViews natives, ou tout hôte qui fournit ses propres événements de resize :

```ts
// gwen.config.ts
export default defineConfig({
  screen: {
    sizeProvider: {
      getSize() {
        return { width: myApp.windowWidth, height: myApp.windowHeight }
      },
      subscribe(callback) {
        myApp.on('resize', callback)
        return () => myApp.off('resize', callback)
      },
    },
  },
})
```

La fonction `subscribe` doit retourner une fonction de nettoyage — GWEN l'appelle automatiquement lors de `engine:stop`.

## Contexte async

`useScreen()` suit les mêmes règles de contexte async que tous les composables GWEN.
**Appelez-le pendant la phase de setup synchrone** — la référence retournée fonctionne partout :

```ts
const PlayerActor = defineActor(PlayerPrefab, () => {
  const screen = useScreen('main')  // ✅ setup synchrone

  onStart(async () => {
    await loadAssets()
    Position.x[id] = screen.pixels.width / 2   // ✅ référence stable
  })
})
```

Voir [Contexte Async](/fr/advanced/async-context) pour les détails.

## Référence des erreurs

| Code | Quand | Solution |
|---|---|---|
| `SCREEN:RESIZE_OBSERVER_NOT_AVAILABLE` | Navigateur sans `ResizeObserver`, ou Node.js sans `sizeProvider` | Ajouter `screen.sizeProvider` dans `gwen.config.ts` |
| `SCREEN:VIEWPORT_NOT_FOUND` | `useScreen('inconnu')` pour un id non enregistré | Vérifier l'id ou déclarer le viewport dans `gwen.config.ts` |
