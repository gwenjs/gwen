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

`@gwenjs/core` fournit aussi un cœur vérifié pour chaque variante, sous `@gwenjs/core/wasm/<variant>-dev` (`opt-level=1`, assertions de debug et contrôles de dépassement activés). Rien ne le charge encore.

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

## Superposition de la config

La couche la plus haute l'emporte.

| Couche | Source | Rôle |
|---|---|---|
| L0 | Défauts du paquet (`defaults` du module) | Valeurs de départ de la section |
| Dérivée | `engine.variant` | Un défaut sous L1, déduit des modules listés. Avec `@gwenjs/physics2d` ou `@gwenjs/physics3d` listé, une autre variante est `APP:CONFIG_CONFLICT`. Sinon la valeur du fichier l'emporte |
| L1 | La section du même nom dans `gwen.config.ts` | Vos valeurs, au-dessus de L0 |

Vite est une pile à part. La base GWEN passe d'abord, puis les extensions enregistrées par les modules, puis votre clé `vite` en dernier.

| Fusion | Règle |
|---|---|
| Objets simples | Fusion en profondeur |
| Tableaux | La couche haute remplace le tableau |
| `undefined` | La valeur basse reste |
| Autres valeurs | La valeur haute est gardée, y compris la même référence d'objet |

| Code | Exemple |
|---|---|
| `APP:CONFIG_INVALID` | `[GWEN] Invalid gwen.config:` puis `"engine" expected an object, received null` |
| `APP:CONFIG_CONFLICT` | La ligne invalide ajoute ` (conflicts with @gwenjs/app)` |
| `APP:CONFIG_LOAD_FAILED` | `[GWEN] No gwen.config.ts (or .js / .mjs / .cjs) found in <cwd>.` et `See https://gwenjs.github.io/gwen/api/errors#app-config-load-failed (APP:CONFIG_LOAD_FAILED)` |
| `CORE:INVALID_CONFIG` | `Invalid config "maxEntities": -1.` |

Sources : `packages/app/src/app.ts:459`, `packages/app/src/config.ts:79-91`, `packages/app/src/config.ts:93-99`, `packages/vite/src/index.ts:491-513`, `packages/app/src/app.ts:200-202`, `packages/app/src/app.ts:257`, `packages/app/src/merge.ts:21-22`, `packages/app/src/config-error.ts:14-22`, `packages/app/tests/config-layering.test.ts:128-130`, `packages/app/tests/config-layering.test.ts:133-138`, `packages/app/tests/config-layering.test.ts:541-549`, `packages/app/tests/config-layering.test.ts:154-157`, `packages/app/src/config-loader.ts:118`, `packages/app/tests/config-loader.test.ts:123-126`, `packages/core/src/engine/config-error.ts:30`, `packages/core/tests/engine/config-validator.test.ts:33`.

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

## Moteurs sur une même instance

Sous `wasmInstance: "shared"`, deux moteurs peuvent tourner sur une même instance WASM. `@gwenjs/core` utilise `auto` par défaut (`packages/core/src/engine/wasm-bridge.ts:530`). Chaque moteur possède ses entités, son monde physique et ses tampons de chemin. Un chemin écrit par un moteur n'est pas le chemin que l'autre moteur lit.

`jsUrl` est l'URL de `gwen_core_factory.js`. `init()` avec `jsUrl` ou `wasmUrl` sur un pont déjà initialisé rejette `CORE:WASM_LOAD_ERROR`.

Ils partagent encore trois choses :

- Le budget de mémoire linéaire. Une instance a une seule `WebAssembly.Memory`. Tous les moteurs de cette instance y allouent. `wasmMemoryBytes` est la taille de cette mémoire.
- L'allocateur. Un seul allocateur sert tous les moteurs de l'instance.
- Le domaine de faute. Un trap laisse la mémoire de l'instance partagée dans un état inconnu. Un trap empoisonne chaque moteur de cette instance partagée avec `CORE:WASM_PANIC`. Le moteur suivant obtient une nouvelle instance.

## Plusieurs moteurs par page ou par processus

`wasmInstance` choisit l'instance WASM (`packages/core/src/engine/wasm-bridge.ts:530`).

| Mode | Comportement |
| --- | --- |
| `shared` | Une instance par module compilé. Les moteurs de ce module partagent sa mémoire linéaire. |
| `isolated` | Une instance par moteur, avec sa propre mémoire linéaire (`packages/core/src/engine/wasm-instance-provider.ts:144`). |
| `auto` (défaut) | Le premier moteur d'un module va sur l'instance du pool de ce module, celle que `shared` utilise (`packages/core/src/engine/wasm-instance-provider.ts:240`). Chaque moteur suivant reçoit sa propre instance tant que moins de `wasmIsolatedBudget` instances isolées sont vivantes dans la page ou le processus (`packages/core/src/engine/wasm-instance-provider.ts:241`, `:243`). Au-delà du budget, ou sur un `RangeError` ou une valeur levée qui n'est pas une `Error`, il rejoint le pool (`packages/core/src/engine/wasm-instance-provider.ts:241`, `:248`). `engine.wasmInstance` est le placement résolu, `"shared"` ou `"isolated"` (`packages/core/src/engine/engine-types.ts:504`). |

`createEngine` de `@gwenjs/core` utilise `auto` par défaut (`packages/core/src/engine/wasm-bridge.ts:530`). Changement cassant : les moteurs 2..K d'un module reçoivent chacun leur propre instance jusqu'au `wasmIsolatedBudget` (16, `packages/core/src/engine/wasm-instance-provider.ts:162`), puis rejoignent le pool ; le premier repli écrit un avertissement par raison. `createEngine` de `@gwenjs/core/node` utilise `isolated` par défaut (voir [Sans affichage / serveur](#sans-affichage-serveur)).

`wasmIsolatedBudget` est un entier >= 0, sinon `CORE:INVALID_CONFIG` (`packages/core/src/engine/engine-config-validator.ts:124`). Le défaut est 16 (`packages/core/src/engine/wasm-instance-provider.ts:162`). `0` met chaque moteur sur le pool (`packages/core/src/engine/wasm-instance-provider.ts:213`). Un moteur en marche ne bouge jamais (`packages/core/src/engine/wasm-bridge.ts:539`). `auto` n'alloue jamais d'instance pour tester la capacité (`packages/core/src/engine/wasm-instance-provider.ts:240`). `LinkError` et `CompileError` ne sont pas un repli : ils rejettent `CORE:WASM_LOAD_ERROR` (`packages/core/src/engine/wasm-instance-provider.ts:199`). Quand un moteur rejoint le pool, le logger du moteur écrit un avertissement par raison (`budget` ou `capacity`) et par page ou processus, avec la charge `{ reason, mode: "auto", isolatedLive, cause? }` (`packages/core/src/engine/engine-factory.ts:22`, `packages/core/src/engine/wasm-instance-provider.ts:168`).

Sous `auto`, les moteurs du pool partagent un seul domaine de faute : un trap les empoisonne tous avec `CORE:WASM_PANIC`. Les moteurs isolés ne sont pas enregistrés auprès du pool, donc ils ne sont pas empoisonnés (`packages/core/src/engine/wasm-bridge.ts:541`).

`isolated` dans le navigateur est pris en charge. Trois projets Playwright le valident : Chromium, Firefox et WebKit (`packages/core/playwright.config.ts:21-23`). Ils lancent `packages/core/tests/browser/isolation.pw.ts` et `packages/core/tests/browser/capacity.pw.ts`. Le défaut du navigateur est `auto`. Sur les appareils iOS, passez `wasmInstance: "shared"`. iOS n'est pas dans la CI.

Capacité mesurée :

| Navigateur | Version | Limite mesurée | Date |
| --- | --- | --- | --- |
| Chromium | 153.0.8010.12 | 123 moteurs isolés créés. Le 124e rejette `CORE:WASM_CAPACITY_EXHAUSTED`, avec un moteur partagé créé d'abord (`packages/core/tests/browser/capacity.pw.ts:46`). | 2026-10-30 |
| Firefox | 155.0 | 998 moteurs isolés créés. Le 999e rejette `CORE:WASM_CAPACITY_EXHAUSTED`. La valeur levée n'est pas une `Error` ; `packages/core/src/engine/wasm-instance-provider.ts:58` la convertit. | 2026-10-30 |
| WebKit | 26.6 | Aucune limite observée jusqu'à 500 moteurs isolés : 500 mémoires distinctes, pas de crash. La boucle du test s'arrête à 500 et ne sonde jamais plus loin (`packages/core/tests/browser/capacity.pw.ts:142`). | 2026-10-30 |
| Node 22 | — | Environ 10 GiB de mémoire virtuelle par instance avec le gestionnaire de traps activé. Prévoir le budget avec `ulimit -v`. | — |

Les valeurs navigateur viennent du run CI 41059346720 (ubuntu-latest, Playwright 1.63.0, job `Browser WASM (Playwright)`). Ce sont des valeurs mesurées sur un runner et à une date. Ce ne sont pas des garanties. Les versions des navigateurs les changent.

Un run manuel, hors CI, a vu le processus de la page WebKit mourir vers 13,575 à 14,600 instances. C'est une observation, pas une limite, et pas une garantie.

Firefox sur ARM64 Android réserve de la place pour 75 grandes mémoires (source SpiderMonkey) ; ce n'est pas mesuré.

Le budget par défaut de 16 (`packages/core/src/engine/wasm-instance-provider.ts:162`) vient des médianes WebKit 26.6 du run CI 41061814726 : 0,492 millisecondes par pas pour les moteurs 1 à 8, 0,5 milliseconde pour les moteurs 9 à 16 (+1,6 %), pas de falaise jusqu'à 16. C'est le plus grand nombre mesuré sans ralentissement. Il est au moins 4 fois sous le plus petit plafond documenté, Firefox ARM64 Android (environ 75, documenté depuis la source, non mesuré). Les plafonds mesurés sont Chromium 123 et Firefox 998. Ce n'est pas une garantie. Changez-le avec `wasmIsolatedBudget`.

Quand `glue.initSync` lève un `RangeError` ou une valeur qui n'est pas une `Error`, `initWasm` lève `CORE:WASM_CAPACITY_EXHAUSTED` en `shared` et `isolated` (`packages/core/src/engine/wasm-instance-provider.ts:58`). En `auto`, le moteur rejoint le pool à la place. Il rejette seulement quand l'instance du pool elle-même ne peut pas être créée, avec `mode "auto"` (`packages/core/src/engine/wasm-instance-provider.ts:198`). Les recours sont `wasmInstance: "shared"`, `wasmInstance: "auto"`, moins de moteurs par processus, ou des worker threads.

Quand le code de capacité est levé, le moteur partagé créé d'abord continue de fonctionner. `capacity.pw.ts` vérifie qu'il avance encore (`packages/core/tests/browser/capacity.pw.ts:74`, `:92`) et qu'un second moteur partagé s'initialise après le rejet (`packages/core/tests/browser/capacity.pw.ts:75`, `:93`).

```ts
const room = await createEngine({ variant: "physics2d", wasmInstance: "isolated" });
const lobby = await createEngine({ variant: "physics2d", wasmInstance: "auto", wasmIsolatedBudget: 4 });
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

Le framework appelle `requestAnimationFrame` en interne. `onUpdate` reçoit un `dt` variable à chaque frame. `engine.start()` lève `GwenError` `CORE:WASM_NOT_INITIALIZED` quand le bridge WASM n'est pas actif, et il ne programme aucune frame. `start()`, `startExternal()` et `advance()` lèvent `GwenEngineStateError` (`CORE:INVALID_STATE_TRANSITION`) sur un appel de cycle de vie illégal. `use()` et `unuse()` sont permis en `idle` et `running` seulement. Ils rejettent avec `GwenEngineStateError` en `starting`, `stopping`, `stopped` et `faulted`. Un moteur arrêté est définitif : il ne prend plus de plugin. Une erreur fatale fait passer le moteur à `faulted` et n'appelle pas `stop()`. Seul le premier `stop()` lance le teardown. `stop()` ne bloque pas en ré-entrée : un `stop()` appelé pendant le teardown rend la main immédiatement. Pour savoir quand le teardown est fini, écoutez `engine:state-change` vers `stopped`. `stop()` enchaîne ensuite, dans cet ordre : le hook `engine:stop`, le `teardown` de chaque plugin dans l'ordre inverse d'installation, l'effacement des hooks, l'effacement de l'isolation, l'effacement des modules WASM de ce moteur, la libération des disposables, la libération du bridge WASM possédé, la libération de la politique d'erreurs, puis l'état `stopped`. Quand vous passez `_bridge`, appelez `bridge.dispose()` après `stop()`. `stop()` libère le bridge WASM qu'il possède. Après la libération d'un bridge possédé, tout appel au bridge qui atteint WASM lève `CORE:ENGINE_DISPOSED` ; `isActive()` renvoie false. Le `teardown` d'un plugin doit être idempotent avec le travail déjà fait sur `engine:stop`. Les services fournis via l'argument `engine` de `setup()` sont retirés avant son `teardown`. Un `provide` sur un moteur capturé, ou `useEngine().provide(...)` dans `setup`, n'est pas retiré. Un moteur `faulted` reste `faulted`.

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

1. Le moteur démarre dans Node sans globaux DOM, depuis des octets ou un module compilé, pour les variantes light, 2D et 3D.
2. `startExternal()` plus un `advance(1 / physicsHz)` exécute un pas fixe et un rendu. `engine:afterTick` s'exécute une fois par pas, et `frameCount` compte ces pas. `advance(dt)` accumule sur la même horloge que `start()`.
3. Avec `physicsHz === 0`, `advance(dt)` exécute un pas. Son `dt` est la valeur de l'appelant, plafonnée par `maxDeltaSeconds` et multipliée par `timeScale`. Il ne vient pas de l'horloge murale. Avec `physicsHz > 0`, la valeur plafonnée est ajoutée à l'accumulateur et chaque pas utilise `1 / physicsHz` multiplié par `timeScale`.
4. Cible (#59) : plusieurs moteurs dans un même processus ne partagent pas d'état d'exécution, et `stop()` sur un moteur laisse les autres tourner. Le pont ne garde pas de module glue sur `globalThis`.
5. Une erreur fatale ne fait passer que ce moteur à `faulted`.
6. Les gestionnaires d'erreur globaux sont optionnels. Le cœur n'en installe aucun sauf si `window` existe.
7. Le déterminisme n'est pas garanti. La note Déterminisme de cette page le dit (#84).
8. Dépasser la capacité d'entités lève `GwenWasmError` avec le code `CORE:ENTITY_LIMIT_REACHED`. Le pont reste utilisable. Le module WASM ne piège pas.

La 1.0 ne fournit ni lockstep, ni rollback, ni snapshot du monde, ni entrée indexée par tick, ni surcharge `advance(dt, inputs)`. Deux pairs sur des plateformes différentes peuvent diverger.
:::

## Sans affichage / serveur

Le moteur tourne dans Node sans DOM. La seule boucle serveur prise en charge est `startExternal()`, puis `advance(dt)` une fois par tick, puis `stop()`. La note Multijoueur (1.0) plus haut nomme la même boucle.

Importez depuis `@gwenjs/core/node`. L'import déclare que le code tourne dans Node. Rien n'est deviné à l'exécution. Aucune option n'est nécessaire.

Le point d'entrée principal ne lit jamais de fichiers.

```ts check
import { createEngine, loadGwenModule } from "@gwenjs/core/node";

async function runServer(): Promise<number> {
  await loadGwenModule("light");
  const engine = await createEngine();
  try {
    await engine.startExternal();
    for (let i = 0; i < 10; i++) await engine.advance(1 / 60);
    return engine.frameCount;
  } finally {
    await engine.stop();
  }
}
```

`createEngine()` utilise la variante `light`. Passez `variant: "physics2d"` ou `"physics3d"` pour les autres. Le glue et le binaire livrés dans le paquet sont trouvés pour vous. Rien n'est téléchargé.

- Chaque moteur reçoit sa propre instance WASM et sa propre mémoire linéaire. `wasmInstance` vaut `"isolated"` par défaut.
- `loadGwenModule(variant)` compile le binaire une fois par variante et renvoie le même `WebAssembly.Module` à chaque appel. L'appeler en premier, comme ci-dessus, déplace le coût de compilation au démarrage.
- Vos sources l'emportent. Un `glue` ou un `jsUrl` que vous passez remplace le glue par défaut. Un `wasmBytes`, `wasmModule` ou `wasmUrl` que vous passez remplace le binaire par défaut. Chaque côté n'est rempli que si vous l'avez laissé vide : les valeurs par défaut ne provoquent donc jamais d'erreur de double source.

La suite tourne sur Node 22. Bun et Deno avec la compatibilité Node ne sont pas testés.

Pour maîtriser toutes les sources vous-même, utilisez le `setupGwen` bas niveau de `@gwenjs/core`. Lisez les octets `.wasm` depuis le binaire livré dans le paquet. Passez-les avec le glue importé à l'avance. Rien n'est téléchargé.

```ts check
import { readFile } from "node:fs/promises";
import { setupGwen } from "@gwenjs/core";
import type { GwenCoreGlueFactoryModule } from "@gwenjs/core/internal";

async function runServer(glue: GwenCoreGlueFactoryModule): Promise<number> {
  const wasmBytes = await readFile(glue.wasmUrl);
  const engine = await setupGwen({ variant: "light", glue, wasmBytes, wasmInstance: "isolated" });
  try {
    await engine.startExternal();
    for (let i = 0; i < 10; i++) await engine.advance(1 / 60);
    return engine.frameCount;
  } finally {
    await engine.stop();
  }
}
```

L'import `GwenCoreGlueFactoryModule` ne sert qu'à typer la fonction. Le vrai code passe directement `import * as glue from "@gwenjs/core/wasm/light/factory"`.

`wasmInstance: "isolated"` donne à chaque moteur sa propre instance WASM et sa propre mémoire linéaire. Pour compiler une fois et partager le résultat, passez `wasmModule: await WebAssembly.compile(wasmBytes)` à la place de `wasmBytes`. Utilisez `variant: "physics2d"` ou `"physics3d"` avec l'import `@gwenjs/core/wasm/<variant>/factory` correspondant.

`engine.loadWasmModule({ name, bytes })` charge un module communautaire sur un serveur sans téléchargement. Passez `module` pour un `WebAssembly.Module` déjà compilé. Passez exactement un parmi `url`, `bytes` ou `module`. Zéro ou plusieurs, ou des octets invalides, rejettent avec `CORE:WASM_LOAD_ERROR`.

### Plusieurs rooms sur des worker threads

Les rooms d'un même thread partagent une seule boucle d'événements. Une room qui ne rend jamais la main les arrête toutes. Un thread n'utilise aussi qu'un seul cœur.

Lancez les rooms sur des worker threads. Chaque worker a sa propre boucle d'événements et peut tourner sur un autre cœur. C'est une recette, pas une API de pool de workers : GWEN n'en ajoute aucune.

Sur le thread principal, compilez le module une fois. Démarrez les workers. Postez le module à chacun.

```ts check
import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import { loadGwenModule } from "@gwenjs/core/node";

async function startWorkers(rooms: number): Promise<Worker[]> {
  const module = await loadGwenModule("physics2d");
  const workers: Worker[] = [];
  for (let i = 0; i < availableParallelism(); i++) {
    const worker = new Worker(new URL("./room-worker.mjs", import.meta.url));
    worker.postMessage({ type: "init", module, rooms });
    workers.push(worker);
  }
  return workers;
}

async function closeWorkers(workers: Worker[]): Promise<void> {
  await Promise.all(workers.map((worker) => worker.terminate()));
}
```

`room-worker.mjs`, dans le worker :

```js
import { parentPort } from "node:worker_threads";
import { setupGwen } from "@gwenjs/core/node";

parentPort.on("message", async ({ module, rooms }) => {
  const engines = [];
  for (let i = 0; i < rooms; i++) {
    engines.push(await setupGwen({ variant: "physics2d", wasmModule: module }));
  }
  // Démarrez chaque moteur avec startExternal(), puis appelez advance(dt) à chaque tick.
});
```

`setupGwen` de `@gwenjs/core/node` utilise `wasmInstance: "isolated"` par défaut (`packages/core/src/node.ts:100`, `:114`). Chaque room est son propre moteur, avec sa propre instance et sa propre mémoire linéaire. Un seul module compilé sert tous les moteurs et tous les workers.

Dimensionnement :

- Démarrez environ un worker par CPU. `os.availableParallelism()` donne ce nombre.
- Mettez plusieurs rooms dans chaque worker.
- Les workers servent les cœurs et le confinement des plantages. N'en démarrez pas un par room.

Coût mesuré : 4 workers de 250 rooms `physics2d` chacun, toutes construites depuis un seul module, ont utilisé environ 380 MiB de RSS. Chaque worker en plus a ajouté environ 10,6 MiB de RSS, mesuré avec 8 workers. Ces chiffres viennent de runs locaux sur arm64 le 2026-10-19 (ticket #268). Les temps sont dans le ticket #268. Ce n'est pas une garantie. Mesurez sur votre matériel.

Une room qui ne rend jamais la main bloque toutes les rooms de son propre worker. Appelez `worker.terminate()` sur ce worker. Les autres workers continuent d'avancer. Un test d'intégration couvre ce cas.

Pour savoir combien de moteurs isolés un processus peut contenir, voir [Plusieurs moteurs par page ou par processus](#plusieurs-moteurs-par-page-ou-par-processus).

### Limites que l'hôte doit faire respecter

`loadWasmModule` refuse une source `url` ou `bytes` au-dessus de `maxBytes` avant `WebAssembly.compile` (`packages/core/src/engine/wasm-module-runner.ts:225`, `packages/core/src/engine/wasm-module-runner.ts:252`). La valeur par défaut est `16 MiB`, soit `16777216` octets (`packages/core/src/engine/wasm-module-runner.ts:83`). Une source `module` est déjà compilée et n'est pas vérifiée (`packages/core/src/engine/engine-types.ts:74`).

GWEN ne plafonne pas `memory.grow`. Le chargement vérifie la taille, puis compile (`packages/core/src/engine/wasm-module-runner.ts:225`, `packages/core/src/engine/wasm-module-runner.ts:252`). Il ne limite pas la croissance ultérieure de la mémoire du module.

GWEN ne peut pas interrompre un appel qui ne revient pas sur le thread principal. Le `step` d'un module s'exécute directement sur ce thread (`packages/core/src/engine/wasm-module-runner.ts:419`).

Exécutez un module auquel vous ne faites pas confiance dans un worker, et appelez `worker.terminate()` dessus. Voir [Plusieurs rooms sur des worker threads](#plusieurs-rooms-sur-des-worker-threads).

## Limites

Chaque moteur a deux limites strictes. Les deux sont propres à chaque moteur : un second moteur dans la même page ou le même processus compte ses propres types et entités. Types : `packages/core/tests/integration-wasm/capacity-limits.test.ts:285`. Entités : chaque `Engine` construit son propre `EntityManager` et son propre `ChunkStore` (`crates/gwen-core/src/bindings.rs:161-162`).

### Types de composants

Un moteur contient au plus `128` types de composants (`crates/gwen-core/src/ecs/error.rs:9`, `packages/core/src/engine/engine-component-registry.ts:25`). Le masque de composants fait 128 bits (`crates/gwen-core/src/ecs/chunk_store.rs:85`). Chaque nom de composant distinct prend un emplacement, la première fois que le moteur le voit.

Le 129e nom lève `GwenComponentLimitError` avec le code `CORE:COMPONENT_TYPE_LIMIT_REACHED` (`packages/core/src/engine/engine-errors.ts:312-346`). L'erreur porte `component`, `owner` (le nom du plugin, ou `null`), `max` et `used`.

`engine.unuse(name)` libère les emplacements que possède un plugin (`packages/core/src/engine/plugin-registry.ts:360-366`). Un plugin possède les types qu'il enregistre pour la première fois de façon synchrone dans `setup`, avant son premier `await`. Un type enregistré pour la première fois après un `await` n'a pas de propriétaire et reste après `unuse` (`packages/core/tests/integration-wasm/capacity-limits.test.ts:159`). Un type qui a encore des lignes vivantes, ou qu'une requête vivante référence, est conservé : `CORE:COMPONENT_TYPE_IN_USE` est géré dans le registre et le type reste (`packages/core/src/engine/engine-component-registry.ts:228-246`).

Lisez l'usage courant avec [`engine.getCapacity()`](/fr/api/core#enginegetcapacity).

### Entités

`maxEntities` est un entier de `1` à `2_000_000` (`crates/gwen-core/src/ecs/error.rs:6`, `crates/gwen-core/src/ecs/chunk_store.rs:233`). La valeur par défaut est `10_000` (`packages/schema/src/engine-config.ts:20`). Une valeur hors de cette plage est refusée. `createEngine` et `setupGwen` la vérifient d'abord et lèvent `GwenConfigError` avec le code `CORE:INVALID_CONFIG` (`packages/core/src/engine/engine-factory.ts:58`, `packages/core/src/engine/engine-factory.ts:100`, `packages/schema/src/engine-config.ts:141-150`, `packages/core/src/engine/config-error.ts:30`). Dans `gwen.config.ts`, l'erreur est `APP:CONFIG_INVALID` (`docs/api/errors.md:168`). `CORE:INVALID_MAX_ENTITIES` n'est que la garde au niveau WASM, atteinte quand vous appelez directement `Engine::new` du WASM brut (`crates/gwen-core/src/ecs/error.rs:169`, `crates/gwen-core/src/ecs/chunk_store.rs:232-236`).

Le moteur alloue la table d'emplacements à cette taille à sa création et ne la fait pas grandir (`crates/gwen-core/src/ecs/chunk_store.rs:228-240`). Quand tous les emplacements sont pris, créer une entité échoue avec `CORE:ENTITY_LIMIT_REACHED` (`packages/core/src/engine/engine-errors.ts:143`).

### Dimensionnement

Choisissez `maxEntities` comme le plus grand nombre d'entités vivantes en même temps, plus une marge. Ne le fixez pas à la valeur maximale « au cas où » : la table d'emplacements est allouée en entier à la création.

Les données des composants vivent dans des chunks. Un chunk contient `1024` lignes (`CHUNK_ROWS`, `crates/gwen-core/src/ecs/chunk_store.rs:22`) pour un archétype, et il est alloué en entier quand sa première ligne en a besoin (`crates/gwen-core/src/ecs/chunk_store.rs:1526-1541`). Sa taille est :

```text
octets du chunk = 1024 × (somme des octets de lane des composants de l'archétype) + 8192
```

Les `8192` sont deux colonnes `u32` de 1024 lignes : l'index d'entité et la génération d'entité. Une lane fait un, quatre ou huit octets (`crates/gwen-core/src/ecs/chunk_store.rs:176-182`). Un layout de composant ne peut pas dépasser `512` octets (`MAX_ROW_BYTES`, `crates/gwen-core/src/ecs/chunk_store.rs:31`, `crates/gwen-core/src/ecs/chunk_store.rs:297`). Le store crée au plus `4096` archétypes (`MAX_ARCHETYPES`, `crates/gwen-core/src/ecs/chunk_store.rs:25`, `crates/gwen-core/src/ecs/chunk_store.rs:427-431`).

Pour chaque archétype qui a déjà contenu une ligne, comptez jusqu'à `ceil(n / 1024) + 1` chunks, et au moins `1`, où `n` est son nombre d'entités vivantes. Quand sa dernière ligne quitte un chunk, le store garde un chunk vide pour cet archétype et le réutilise pour la ligne suivante (`crates/gwen-core/src/ecs/chunk_store.rs:1612-1633`, `crates/gwen-core/src/ecs/chunk_store.rs:2041-2068`). L'archétype et ses chunks restent jusqu'à ce qu'un de ses types de composant soit libéré par `unuse` (`crates/gwen-core/src/ecs/chunk_store.rs:372`). Comptez chaque archétype déjà atteint, y compris les intermédiaires que des appels successifs à `addComponent` traversent : ajouter `A`, puis `B`, crée un archétype `A` et un archétype `A+B`. Des entités qui diffèrent d'un seul composant sont dans des archétypes différents : un jeu avec beaucoup de combinaisons de composants paie le chunk de 1024 lignes une fois par combinaison.

### Rebouclage de la génération

Un id d'entité porte une génération `u32`. Le moteur émet les ids depuis son `EntityManager` (`crates/gwen-core/src/bindings.rs:161`, `crates/gwen-core/src/bindings.rs:187-192`). Ce gestionnaire incrémente la génération d'un emplacement avec `wrapping_add(1)` quand il réutilise l'emplacement libéré (`crates/gwen-core/src/ecs/entity.rs:68`). Un id périmé est refusé quand sa génération diffère de celle de l'emplacement, avant d'atteindre le store (`crates/gwen-core/src/ecs/entity.rs:126`, `crates/gwen-core/src/bindings.rs:198`). Les emplacements ne sont pas retirés. Après 2^32 réutilisations du même emplacement, un id périmé de cet emplacement redevient valide. Le chunk store garde un compteur miroir, incrémenté à la suppression (`crates/gwen-core/src/ecs/chunk_store.rs:584`).

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
