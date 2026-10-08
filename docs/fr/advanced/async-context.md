---
title: Contexte asynchrone
description: Comment GWEN propage le contexte du moteur à travers les callbacks de cycle de vie asynchrones, et quoi faire quand ce n'est pas le cas.
---

# Contexte asynchrone

Les composables GWEN — `useEngine()`, `useHTML()`, `usePhysics2D()`, et tout composable de service issu d'un plugin — reposent sur un contexte moteur interne actif au moment de leur appel. Par défaut ce contexte est **synchrone** : il est défini avant l'exécution d'un callback et effacé à sa sortie.

Cela signifie qu'après un `await` dans un callback asynchrone, le contexte n'est plus actif :

```ts
const GameScene = defineScene('game', () => {
  onEnter(async () => {
    await loadAssets()
    useHTML().mount('hud')  // ❌ GwenContextError — contexte perdu après await
  })
})
```

GWEN résout cela automatiquement pour `onEnter` et `onExit` via un transform Vite au build. Pour les autres cas, une trappe d'échappement explicite est disponible.

---

## Correction automatique — `onEnter` et `onExit`

Quand `@gwenjs/vite` est dans votre config Vite (via `gwenVitePlugin()`), GWEN instrumente chaque `await` dans les callbacks `onEnter` et `onExit` au moment du build. Le contexte moteur est sauvegardé avant chaque point de suspension et restauré après sa résolution.

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { gwenVitePlugin } from '@gwenjs/vite'

export default defineConfig({
  plugins: [gwenVitePlugin()],  // ← transform de contexte asynchrone inclus
})
```

Avec le plugin configuré, `onEnter` et `onExit` asynchrones fonctionnent de façon transparente :

```ts
const GameScene = defineScene('game', () => {
  onEnter(async () => {
    await loadAssets()         // ← le transform instrumente ce await
    useHTML().mount('hud')     // ✅ contexte restauré automatiquement
    usePhysics2D().resume()    // ✅ idem
  })

  onExit(async () => {
    await saveProgress()
    useHTML().unmount()        // ✅
  })
})
```

Aucun import, aucun wrapper, aucune configuration au-delà de `gwenVitePlugin()`.

---

## Acteurs — le pattern de capture

Pour les acteurs, l'approche recommandée est de capturer les handles de composables pendant la **phase factory synchrone**, puis d'utiliser ces handles dans les callbacks asynchrones. C'est identique à la convention Vue `setup()` et n'a aucun coût.

```ts
const PlayerActor = defineActor(PlayerPrefab, () => {
  // ✅ capture pendant la factory sync — le contexte moteur est toujours actif ici
  const transform = useTransform()
  const html = useHTML()

  onStart(async () => {
    await loadPlayerAssets()
    transform.setPosition(400, 300)  // ✅ closure — aucun contexte requis
    html.show('player-hud')          // ✅ idem
  })

  onDestroy(() => {
    html.hide('player-hud')
  })
})
```

La factory s'exécute une seule fois lors de la mise en place du plugin, avec le contexte moteur actif. Les handles (`transform`, `html`) capturent tout ce dont ils ont besoin à ce moment — ils fonctionnent comme des closures ordinaires dans n'importe quel callback, synchrone ou asynchrone.

---

## `withAsyncContext` — la trappe d'échappement

Si vous avez vraiment besoin d'appeler un composable **après** un `await` dans `onStart` ou un callback asynchrone personnalisé, utilisez `withAsyncContext` :

```ts
import { withAsyncContext } from '@gwenjs/core'

const EnemyActor = defineActor(EnemyPrefab, () => {
  onStart(withAsyncContext(async () => {
    await spawnAnimation()
    useHTML().show('enemy-hp-bar')  // ✅ contexte restauré
  }))
})
```

`withAsyncContext` nécessite :
1. **`@gwenjs/vite` dans votre config Vite** — le transform instrumente les appels `await`
2. **Appelé depuis un contexte moteur actif** — doit être défini dans une factory (`defineActor`, `defineSystem`, `defineScene`), pas au niveau module

::: warning Performance — à éviter dans les chemins haute fréquence
`withAsyncContext` définit le contexte moteur à chaque invocation. S'il est utilisé dans `onStart` d'un acteur qui spawne des centaines de fois par frame (balles, particules), privilégiez le **pattern de capture** ci-dessus — il n'a aucun coût au spawn.
:::

::: tip Privilégier le pattern de capture
`withAsyncContext` est une trappe d'échappement, pas le défaut. Si le pattern de capture fonctionne pour votre cas, utilisez-le — il est plus simple, plus rapide et ne nécessite pas de connaissance du transform.
:::

---

## Systèmes — synchrones par conception

Les hooks de système (`onUpdate`, `onBeforeUpdate`, `onAfterUpdate`, `onRender`) s'exécutent dans la boucle de frame et sont toujours synchrones. Ils n'ont pas de variante asynchrone par conception — attendre dans une frame bloquerait le moteur.

Le contexte moteur est toujours actif dans ces hooks. Aucune gestion particulière n'est nécessaire.

```ts
const RenderSystem = defineSystem(() => {
  const html = useHTML()  // ✅ capturé dans le setup synchrone

  onUpdate((dt) => {
    html.update(dt)  // ✅ closure — fonctionne toujours
  })
})
```

---

## Guide d'erreurs — `GwenContextError`

Quand un composable est appelé hors d'un contexte moteur actif, GWEN lance une `GwenContextError` avec une propriété `code` structurée et un message actionnable.

```ts
import { GwenContextError } from '@gwenjs/core'

try {
  useEngine()
} catch (e) {
  if (e instanceof GwenContextError) {
    console.log(e.code)     // 'CORE:OUTSIDE_ENGINE_CONTEXT'
    console.log(e.message)  // explique le correctif étape par étape
  }
}
```

### Diagnostiquer "contexte perdu après await"

Si vous voyez `GwenContextError` levée depuis du code dans un `onEnter` ou `onExit` :

1. **Vérifiez que `gwenVitePlugin()` est dans votre `vite.config.ts`** — sans le plugin, le transform ne s'exécute pas et les contextes ne sont pas propagés.
2. **Vérifiez que la fonction est passée directement à `onEnter`/`onExit`** — le transform cherche `onEnter(async () => {...})`. Assigner la fonction à une variable au préalable désactive le transform.
3. **Pour `onStart` et les callbacks personnalisés**, utilisez `withAsyncContext()` ou le pattern de capture.

### Diagnostiquer "appelé hors contexte moteur"

Si l'erreur apparaît dans du code qui n'est dans aucun callback de cycle de vie :

```ts
// ❌ niveau module — aucun contexte moteur
const engine = useEngine()
```

Utilisez `engine.run()` pour définir le contexte explicitement :

```ts
const engine = await createEngine(...)
engine.run(() => {
  // ✅ contexte actif ici
  const svc = useMyPlugin()
})
```

---

## Référence rapide

| Où | Appels composables async fonctionnent ? | Comment |
|---|---|---|
| Factory `defineSystem()` | ✅ Oui (sync) | Contexte moteur actif |
| Factory `defineScene()` | ✅ Oui (sync) | Contexte moteur actif |
| Factory `defineActor()` | ✅ Oui (sync) | Contexte moteur actif |
| `onUpdate` / `onRender` | ✅ Oui (sync) | Contexte de boucle de frame |
| `onEnter` / `onExit` | ✅ Oui (async) | Transform Vite + `callAsync` |
| `onStart` async après `await` | ⚠️ Opt-in | `withAsyncContext()` ou pattern de capture |
| Niveau module | ❌ Jamais | Utiliser `engine.run()` |

---

## Prochaines étapes

- **[Scènes](/fr/essentials/scenes)** — `onEnter` et `onExit` en détail.
- **[Acteurs](/fr/essentials/actors)** — Cycle de vie des acteurs et pattern de capture.
- **[Mode debug](/fr/advanced/debug-mode)** — Flags de debug globaux et journalisation.
