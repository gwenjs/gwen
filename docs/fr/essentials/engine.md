---
title: Le moteur
description: Configurer le moteur GWEN avec gwen.config.ts et y accéder à l'exécution.
---

# Le moteur

Le **moteur GWEN** est le runtime qui démarre votre jeu, charge le WASM, gère les scènes et exécute vos systèmes à chaque frame. La configuration se fait dans **`gwen.config.ts`** au moment du build — vous ne démarrez jamais le moteur manuellement.

::: info Import explicite requis
`useEngine` n'est pas auto-importé. Importez-le explicitement quand vous avez besoin d'accéder directement au moteur :
```ts
import { useEngine } from '@gwenjs/core'
```
:::

## Configuration de build

Utilisez `defineConfig()` depuis `@gwenjs/app` pour déclarer les modules et les options du moteur :

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    targetFPS: 60,
  },
})
```

Ce fichier est traité au moment du build par le plugin Vite.

## Référence de configuration

| Propriété | Type | Description |
|---|---|---|
| `modules` | `string[]` | Modules à activer (ex. `['@gwenjs/physics2d']`) |
| `engine.maxEntities` | `number` | Nombre max d'entités simultanées (défaut `10_000`) |
| `engine.targetFPS` | `number` | FPS cible (défaut `60`) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | Variante WASM à charger |
| `engine.loop` | `'internal' \| 'external'` | Mode de boucle de jeu (défaut `'internal'`) |
| `engine.maxDeltaSeconds` | `number` | Delta temps max par frame (défaut `0.1`) |
| `engine.physicsHz` | `number` | Fréquence de simulation fixe en Hz. `0` = delta variable (défaut) |
| `engine.maxCatchupSteps` | `number` | Nombre max de pas fixes par frame réelle (défaut `2`) |
| `engine.debug` | `boolean` | Activer le mode debug global |
| `vite` | `object` | Extension statique de la config Vite |
| `hooks` | `Partial<GwenBuildHooks>` | Abonnements aux hooks de build |
| `plugins` | `GwenPlugin[]` | Inscription directe de plugins (escape hatch) |

## Étendre Vite

GWEN gère votre configuration Vite — pas besoin de `vite.config.ts`. Utilisez le champ `vite` pour une config statique :

```ts
export default defineConfig({
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
  },
})
```

Pour une config conditionnelle ou programmatique, utilisez le hook de build :

```ts
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = { '~assets': './src/assets' }
    },
  },
})
```

## Accéder au moteur à l'exécution

Dans une factory de système ou d'acteur, appelez `useEngine()` pour obtenir l'instance brute du moteur. C'est rarement nécessaire — les composables comme `useQuery`, `useService` et `useHook` couvrent la plupart des cas d'usage.

```ts
import { useEngine } from '@gwenjs/core'

export const DebugSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    const stats = engine.getStats()
    console.log(`FPS: ${stats.fps}, frame : ${stats.frameCount}`)
  })
})
```

## Statistiques de frame

`engine.getStats()` retourne des métriques de performance en direct :

| Champ | Type | Description |
|---|---|---|
| `fps` | `number` | Images par seconde, lissées à partir de la durée de frame brute |
| `rawFrameTime` | `number` | Durée de frame en secondes, sans plafond ni échelle de temps |
| `frameCount` | `number` | Frames terminées. En mode fixe, une par pas de simulation |
| `deltaTime` | `number` | Dernier pas en secondes, après le plafond et `timeScale` |
| `entityCount` | `number` | Entités vivantes au moment de l'appel |
| `budgetMs` | `number` | Budget de frame en ms (`1000 / targetFPS`) |
| `wasmMemoryBytes` | `number` | Mémoire linéaire WASM en octets. Absent si le bridge n'a pas de mémoire |
| `phaseMs` | `object` | Temps par phase en ms. Présent seulement si `__GWEN_DEV__` et `debug` sont vrais |
| `overBudget` | `boolean` | Présent seulement avec `phaseMs`. `true` si `phaseMs.total` dépasse `budgetMs` |

En mode boucle externe (`engine.loop: 'external'`), avancez les frames manuellement avec `engine.advance(delta)` :

```ts
engine.advance(delta)  // exécuter une frame avec le delta donné (en secondes)
```

## Modes de boucle

GWEN supporte trois configurations de boucle, définies via `engine.loop` et `engine.physicsHz` dans `gwen.config.ts`.

### Boucle interne (défaut)

Le framework appelle `requestAnimationFrame` en interne. `onUpdate` reçoit un `dt` variable à chaque frame. `engine.start()` lève `GwenError` `CORE:WASM_NOT_INITIALIZED` quand le bridge WASM n'est pas actif, et il ne programme aucune frame. `start()`, `startExternal()` et `advance()` lèvent `GwenEngineStateError` (`CORE:INVALID_STATE_TRANSITION`) sur un appel de cycle de vie illégal. `use()` et `unuse()` sont permis en `idle` et `running` seulement. Ils rejettent avec `GwenEngineStateError` en `starting`, `stopping`, `stopped` et `faulted`. Un moteur arrêté est définitif : il ne prend plus de plugin. Une erreur fatale fait passer le moteur à `faulted` et n'appelle pas `stop()`. Seul le premier `stop()` lance le teardown. `stop()` ne bloque pas en ré-entrée : un `stop()` appelé pendant le teardown rend la main immédiatement. Pour savoir quand le teardown est fini, écoutez `engine:state-change` vers `stopped`.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'internal', targetFPS: 60 },
})
```

### Boucle externe

Utilisez `loop: 'external'` quand vous contrôlez la boucle vous-même — par exemple dans un rendu personnalisé, un harnais de test, ou une simulation côté serveur.

```ts
// gwen.config.ts
export default defineConfig({
  engine: { loop: 'external' },
})
```

Le framework appelle `engine.startExternal()` au lieu de `engine.start()`. Avancez les frames manuellement :

```ts
// votre boucle
function tick(dt: number) {
  engine.advance(dt) // secondes
  requestAnimationFrame(() => tick(getDelta()))
}
```

### Pas fixe

Définissez `physicsHz` à une valeur non nulle pour activer une boucle à pas fixe. `onUpdate` reçoit toujours `1 / physicsHz` comme `dt`, quelle que soit la cadence réelle.

```ts
export default defineConfig({
  engine: {
    physicsHz: 60,      // 60 pas fixes par seconde
    maxCatchupSteps: 2, // au plus 2 pas par frame réelle
  },
})
```

Le pattern accumulateur :
1. À chaque frame d'affichage, le temps écoulé s'accumule. `advance(dt)` ajoute `dt` au même accumulateur.
2. Pour chaque `1 / physicsHz` secondes accumulées, un pas de simulation est déclenché, jusqu'à `maxCatchupSteps`.
3. Les pas entiers encore présents après ce plafond sont abandonnés.
4. Un seul `engine:render(alpha)` suit ces pas, y compris quand aucun pas n'a tourné. `alpha` est la fraction de pas restante, dans `[0, 1)`, et ignore `timeScale`.

### Interpolation

Avec `physicsHz > 0`, chaque pas fixe enregistre un échantillon d'historique 2D après `update_transforms` et avant `engine:update`. `engine.frame` est le même objet pendant toute la vie du moteur.

`engine.frame.alpha` est la valeur passée au dernier `engine:render`. Elle vaut `1` quand `physicsHz` est `0`, et la fraction de pas restante sinon. `engine.frame.rendering` est vrai seulement pendant ces handlers. `engine.frame.transforms2D` est la paire d'historique, ou `null` quand `physicsHz` est `0`, avant la première paire du pas fixe, et après `stop()`.

Un renderer lit un slot depuis `engine:render`. Déclarez `out` une fois. La fonction écrit dedans et n'alloue rien.

```ts
import { readInterpolatedTransform2D } from '@gwenjs/core'

const out = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

engine.hooks.hook('engine:render', (alpha) => {
  const pair = engine.frame.transforms2D
  if (pair === null) return
  if (!readInterpolatedTransform2D(pair, slot, alpha, out)) return
  draw(out.x, out.y, out.rotation)
})
```

La fonction renvoie false, et ne touche pas `out`, quand `slot` est hors de la paire ou que l'échantillon courant n'a pas de transform. Un drapeau de téléportation, ou un échantillon précédent sans transform, copie l'échantillon courant.

`useTransform().world` utilise cet échantillon pour `x`, `y` et `rotation` pendant le rendu, quand la paire est présente et que le slot courant a une transform. `worldRaw` lit toujours le cache monde brut. `scaleX` et `scaleY` restent `1` des deux côtés, et `z` reste `0`. `teleport(x, y)` fixe la position locale et marque le prochain commit d'historique, donc les rendus suivants sautent au lieu de mélanger.

L'échantillon enregistré sur un pas n'inclut pas les écritures `engine:update` de ce même pas. Ces écritures sont publiées au pas suivant. Un rendu à `alpha` 0 copie l'échantillon précédent. C'est le retard d'un pas.

`createEntity()` alloue une entité wasm. `destroyEntity` appelle `delete_entity`, émet `entity:destroy` et ne retire pas le nœud de transform. L'enregistrement reste. Le commit suivant ignore cet enregistrement mort après avoir vidé le tampon, donc le slot est à zéro et `readInterpolatedTransform2D` renvoie false. Un renderer doit abandonner l'entité sur `entity:destroy`. Le ticket #220 retire le nœud.

`physicsHz === 0` n'alloue pas les tampons d'historique. `alpha` reste `1`, `transforms2D` reste `null`, et `world` est égal à `worldRaw`.

Le callback `renderViews` d'un renderer surface reçoit toujours `1`. Cette page ne change pas cet appel.

`engine.timeScale` ne multiplie que le `dt` du pas. Un `timeScale` de `0.5` divise par deux la vitesse de simulation et laisse `alpha` inchangé.

::: info Déterminisme
Avec `physicsHz > 0`, chaque pas de simulation s'exécute avec le même `dt`. Deux exécutions atteignent le même état du monde lorsque chaque pas fixe reçoit les mêmes entrées dans le même ordre, en partant de la même configuration, sur la même version de GWEN, la même variante WASM et le même navigateur ou runtime. Pour contrôler les pas exactement, pilotez la boucle vous-même avec `engine.advance(1 / physicsHz)`. GWEN 1.0 ne garantit pas le déterminisme entre navigateurs, systèmes d'exploitation ou processeurs, et n'en donne aucune pour la boucle à delta variable (`physicsHz: 0`). Lire `performance.now()`, `Date.now()` ou `Math.random()` dans un système casse la reproductibilité. GWEN 1.0 n'a pas de snapshot du monde ni de sauvegarde/restauration intégrés.
:::

::: info Multijoueur (1.0)
Le jeu en réseau ne fait pas partie de GWEN 1.0. Le transport, la prédiction et la gestion d'intérêt restent des plugins futurs. Dans Node, la seule boucle prise en charge est `startExternal()` puis `advance(dt)`. `start()` et son repli `setTimeout` ne sont pas une boucle serveur prise en charge.

Ce sont des cibles 1.0. Une ligne marquée Cible n'est pas vraie dans le code actuel.

1. Cible (#89) : le moteur démarre dans Node sans globaux DOM, depuis des octets ou un module compilé, pour les variantes light, 2D et 3D.
2. `startExternal()` plus un `advance(1 / physicsHz)` exécute un pas fixe et un rendu. `engine:afterTick` s'exécute une fois par pas, et `frameCount` compte ces pas. `advance(dt)` accumule sur la même horloge que `start()`.
3. Avec `physicsHz === 0`, `advance(dt)` exécute un pas. Son `dt` est la valeur de l'appelant, plafonnée par `maxDeltaSeconds` et multipliée par `timeScale`. Il ne vient pas de l'horloge murale. Avec `physicsHz > 0`, la valeur plafonnée est ajoutée à l'accumulateur et chaque pas utilise `1 / physicsHz` multiplié par `timeScale`.
4. Cible (#59) : plusieurs moteurs dans un même processus ne partagent pas d'état d'exécution, et `stop()` sur un moteur laisse les autres tourner. Jusqu'à #59, `stop()` efface chaque clé `__gwenGlue_*` de `globalThis`.
5. Une erreur fatale ne fait passer que ce moteur à `faulted`.
6. Les gestionnaires d'erreur globaux sont optionnels. Le cœur n'en installe aucun sauf si `window` existe.
7. La reproductibilité des pas fixes est la note Déterminisme de cette section (#84).
8. Dépasser la capacité d'entités lève `GwenWasmError` avec le code `CORE:ENTITY_LIMIT_REACHED`. Le pont reste utilisable. Le module WASM ne piège pas.

La 1.0 ne fournit ni lockstep, ni rollback, ni snapshot du monde, ni entrée indexée par tick, ni surcharge `advance(dt, inputs)`. Deux pairs sur des plateformes différentes peuvent diverger.
:::

## Résumé de l'API

| | |
|---|---|
| `defineConfig(options)` | Configuration du framework au moment du build |
| `useEngine()` | Accéder au moteur brut (tout contexte moteur) |
| `engine.getStats()` | Métriques de performance en direct |
| `engine.advance(delta)` | Avance manuelle d'une frame (mode boucle externe uniquement) |

## Étapes suivantes

- **[Composants](/fr/essentials/components)** — Définissez les structures de données de votre jeu.
- **[Systèmes](/fr/essentials/systems)** — Écrivez des systèmes pour déplacer et mettre à jour les entités.
- **[Scènes](/fr/essentials/scenes)** — Organisez votre jeu en états distincts.
- **[Acteurs](/fr/essentials/actors)** — Créez des objets de jeu composables basés sur des instances.
