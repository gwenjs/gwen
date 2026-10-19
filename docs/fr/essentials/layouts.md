---
title: Layouts
description: Couches d'UI persistantes qui survivent aux transitions de scènes — idéales pour les HUD, barres de menus et l'UI globale.
---

# Layouts

Un **layout** est une couche persistante qui vit au-dessus de toutes les scènes. Contrairement aux scènes (qui se chargent et se déchargent), un layout persiste lors des transitions de scènes. Utilisez les layouts pour les HUD, les barres de menu, les boîtes de dialogue de pause et toute UI qui devrait survivre lorsque vous changez de scènes.

::: info Auto-imports
Dans un projet GWEN, `defineLayout`, `useLayout`, `placeActor`, `placeGroup` et `placePrefab` sont auto-importés — aucune ligne `import` nécessaire.
:::

## Définir un layout

Utilisez `defineLayout()` pour déclarer une couche persistante. Dans la factory, placez des acteurs avec `placeActor()` en indiquant leur position initiale et leurs props :

```ts
import { HUDActor } from './actors/hud'
import { MinimapActor } from './actors/minimap'

export const GameLayout = defineLayout(() => {
  const hud     = placeActor(HUDActor,     { at: [0, 0] })
  const minimap = placeActor(MinimapActor, { at: [700, 16] })
  return { hud, minimap }
})
```

L'objet retourné par la factory devient `layout.refs` — un record typé de valeurs `PlaceHandle`, une par acteur placé.

## PlaceHandle

`placeActor()` retourne un `PlaceHandle` avec un accès direct à l'entité placée :

| Propriété / Méthode | Description |
|---|---|
| `handle.api` | L'API publique de l'acteur (valeur de retour de la factory d'acteur) |
| `handle.entityId` | L'ID `bigint` de l'entité |
| `handle.moveTo([x, y])` | Repositionner l'entité en espace monde |
| `handle.despawn()` | Despawner cette entité immédiatement |

```ts
const layout = useLayout(GameLayout, { lazy: true })
await layout.load()

// Appeler une méthode sur l'acteur HUD
layout.refs.hud.api.setScore(100)

// Déplacer la minimap
layout.refs.minimap.moveTo([680, 16])
```

## Options de placement

Tous les composables `place*` acceptent un second argument avec des options de placement :

| Option | Type | Description |
|---|---|---|
| `at` | `[x, y]` | Position locale. Défaut `[0, 0]` |
| `rotation` | `number` | Rotation locale en radians. Défaut `0` |
| `scale` | `number \| [sx, sy]` | Échelle uniforme ou par axe. Défaut `1` |
| `parent` | `PlaceHandle` | Handle parent — la position est relative au parent |
| `props` | `object` | Props transmises à l'acteur au moment du spawn |

```ts
export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, {
    at: [0, 0],
    props: { initialScore: 0 },
  })

  // Groupe d'ancrage — les enfants héritent de sa transform
  const topBar = placeGroup({ at: [0, 0] })
  const timer  = placeActor(TimerActor, { at: [400, 8], parent: topBar })

  return { hud, topBar, timer }
})
```

## Spawn progressif avec `chunkSize`

Par défaut, `load()` spawne toutes les entités placées en une seule passe. Un layout avec beaucoup d'entités peut ralentir cette frame. Passez `chunkSize` pour répartir le spawn sur plusieurs frames :

```ts run
import assert from "node:assert/strict";
import { defineLayout, placeGroup, useLayout } from "@gwenjs/core/actor";

const Tiles = defineLayout(() => ({
  a: placeGroup({ at: [0, 0] }),
  b: placeGroup({ at: [1, 0] }),
  c: placeGroup({ at: [2, 0] }),
  d: placeGroup({ at: [3, 0] }),
  e: placeGroup({ at: [4, 0] }),
}));

const alive = () => engine.getStats().entityCount;
const base = alive();
const layout = await engine.run(() => useLayout(Tiles, { lazy: true, chunkSize: 2 }));

let loaded = false;
const loading = layout.load().then(() => {
  loaded = true;
});
assert.equal(alive() - base, 0);
assert.deepEqual(layout.refs, {});

await engine.advance(1 / 60);
assert.equal(alive() - base, 2);
await engine.advance(1 / 60);
assert.equal(alive() - base, 4);
await Promise.resolve();
assert.equal(loaded, false);

await engine.advance(1 / 60);
assert.equal(alive() - base, 5);
await loading;
assert.equal(loaded, true);
assert.deepEqual(Object.keys(layout.refs), ["a", "b", "c", "d", "e"]);

await layout.dispose();
```

Cinq entités avec `chunkSize: 2` demandent trois frames : deux, puis deux, puis une. En général, un layout de `m` entités se charge en `ceil(m / chunkSize)` frames.

Fonctionnement :

- `chunkSize` doit être un entier strictement positif. Sinon `useLayout()` lève une `GwenComposableError` de code `COMPOSABLE:INVALID_CHUNK_SIZE`, et le message nomme la valeur.
- La factory s'exécute une seule fois, à l'appel de `load()`. Chaque appel à `placeActor`, `placePrefab` ou `placeGroup` enregistre seulement son spawn.
- Les spawns enregistrés s'exécutent dans l'ordre des appels, au plus `chunkSize` par frame, dans la phase `engine:before-update`. Le moteur doit avancer pour que le chargement se termine.
- `load()` est résolu quand la dernière entité est vivante. Jusque-là, `layout.refs` vaut `{}` et `layout.active` vaut `false`.
- Un second `load()` pendant le chargement retourne la même promesse. Il ne spawne pas deux fois.
- Sans `chunkSize`, rien ne change : une seule passe, même ordre des entités.

### Les handles dans la factory

Pendant que la factory s'exécute, aucune entité n'existe encore. Lire `entityId`, `api`, `moveTo` ou `despawn` sur un handle à cet endroit lève une `GwenComposableError` de code `COMPOSABLE:LAYOUT_HANDLE_NOT_SPAWNED`.

Vous pouvez quand même passer un handle en `parent`. Le parent est lu au moment où l'enfant spawne, et les spawns suivent l'ordre des appels. Placez le parent en premier :

```ts
const GridLayout = defineLayout(() => {
  const grid = placeGroup({ at: [0, 0] })
  const tile = placeGroup({ at: [8, 8], parent: grid }) // grid spawne en premier
  return { grid, tile }
})
```

Si un `parent` est placé après son enfant, le spawn de l'enfant lève la même erreur et `load()` est rejeté. Voir [Quand un spawn échoue](#quand-un-spawn-echoue).

### Disposer ou arrêter pendant le chargement

`engine.stop()` pendant un chargement progressif fait la même chose que `dispose()` : `load()` ne reste jamais bloqué et `engine.stop()` n'est jamais rejeté à cause du layout. `dispose()` pendant un chargement progressif arrête les spawns restants et détruit les entités déjà vivantes. Cela vaut d'où que `dispose()` soit appelé : entre deux frames, depuis un autre hook `engine:before-update` de la même frame, ou depuis un spawn en cours (par exemple le setup d'un acteur). Dans ce dernier cas, l'entité en construction est détruite aussi. La promesse de `load()` en attente est résolue, `layout.refs` reste `{}` et `layout.active` reste `false`.

### Quand un spawn échoue

Si un appel `place*` ou la factory lève une erreur, le chargement s'arrête, toutes les entités créées par le layout sont détruites (y compris celle qui était à moitié construite au moment de l'erreur), et `load()` est rejeté avec cette erreur. Cela vaut avec et sans `chunkSize`. Si la destruction échoue aussi, `load()` est quand même rejeté avec l'erreur d'origine. Après un chargement en échec, `layout.active` vaut `false`, `layout.refs` vaut `{}`, et un `load()` ultérieur relance la factory.

Avec `lazy: false`, personne n'attend `load()`. Un échec, progressif ou non, est émis sur le bus d'erreurs du moteur (`engine.errors`) avec le niveau `error`, le code `COMPOSABLE:LAYOUT_LOAD_FAILED` et l'erreur d'origine dans `error`. Utilisez `lazy: true` et attendez `load()` si vous voulez la gérer vous-même.

Quand personne ne peut recevoir l'erreur d'un nettoyage, elle va aussi sur le bus d'erreurs, avec le code `COMPOSABLE:LAYOUT_DISPOSE_FAILED`. Cela arrive quand le nettoyage s'exécute dans un hook de frame (un `dispose()` appelé depuis un spawn) ou dans `engine.stop()`. `engine.stop()` n'est jamais rejeté à cause d'un layout.

## Layouts et cycle de vie des scènes

La factory `defineScene` s'exécute **une seule fois au bootstrap** — pas à chaque navigation. `useLayout` appelé dans la factory crée le handle et le capture dans une closure, mais ne charge pas encore le layout. `onEnter` et `onExit` s'exécutent à chaque navigation et c'est là que vous chargez et disposez :

```ts
export const GameScene = defineScene('game', () => {
  // La factory s'exécute UNE fois au bootstrap — handle capturé, layout pas encore chargé
  const layout = useLayout(GameLayout, { lazy: true })

  // S'exécute à chaque activation de la scène
  onEnter(async () => await layout.load())

  // S'exécute à chaque désactivation de la scène
  onExit(async () => await layout.dispose())
})
```

**Ordre de transition** lors d'une navigation de la scène A vers la scène B :

```
onTransitionLeave({ from: A, to: B })   ← jouer l'animation de sortie
onExit()                                 ← layout.dispose() — acteurs despawnés
scene:leave
scene:enter
onEnter()                                ← layout.load() — acteurs spawnés
onTransitionEnter({ from: A, to: B })   ← jouer l'animation d'entrée
```

::: warning Utilisez toujours `lazy: true` dans les factories de scène
Sans `{ lazy: true }`, `useLayout` appelle `load()` immédiatement pendant la factory — au bootstrap, avant qu'aucune scène ne soit active. Utilisez `lazy: true` chaque fois que le layout doit se charger et se décharger avec le cycle de vie de la scène.
:::

API `LayoutHandle` :

| | |
|---|---|
| `layout.load()` | Activer — spawne tous les acteurs placés. Retourne `Promise<void>`, résolu quand toutes les entités sont vivantes |
| `layout.dispose()` | Désactiver — despawne tous les acteurs placés. Retourne `Promise<void>` |
| `layout.active` | `true` si le layout est chargé |
| `layout.refs` | Record typé de valeurs `PlaceHandle`. `{}` jusqu'à la résolution de `load()` |

## Exemple complet — HUD de jeu

Un acteur HUD qui met à jour le score et la santé, placé dans un layout qui persiste entre les scènes :

```ts
// src/actors/hud.ts
import { HUDPrefab } from '../prefabs/hud'
import { HUDData } from '../components/hud'

export const HUDActor = defineActor(HUDPrefab, () => {
  const data = useComponent(HUDData)

  onUpdate(() => {
    renderHUD({ score: data.score, health: data.health })
  })

  return {
    setScore:  (n: number) => { data.score  = n },
    setHealth: (n: number) => { data.health = n },
  }
})

// src/layouts/game-layout.ts
import { HUDActor } from '../actors/hud'

export const GameLayout = defineLayout(() => {
  const hud = placeActor(HUDActor, { at: [0, 0] })
  return { hud }
})

// src/scenes/game-scene.ts
import { GameLayout } from '../layouts/game-layout'

export const GameScene = defineScene('game', () => {
  const layout = useLayout(GameLayout, { lazy: true })

  onEnter(async () => await layout.load())
  onExit(async ()  => await layout.dispose())
})

// Mettre à jour le HUD depuis un autre système — via refs.api
layout.refs.hud.api.setScore(newScore)
```

## Layout vs Scène

| | Layout | Scène |
|---|---|---|
| **Persistance** | Survit aux transitions de scènes | Se charge/décharge par scène |
| **Systèmes** | — | S'exécutent pendant que la scène est active |
| **Acteurs** | Placés via `placeActor` | Enregistrés via `useActor` |
| **Cas d'usage** | HUD, barres de menu, UI globale | États du jeu, logique de niveau |

## Résumé de l'API

| | |
|---|---|
| `defineLayout(factory)` | Déclarer une couche d'UI persistante |
| `placeActor(def, options?)` | Placer un acteur — retourne `PlaceHandle<API>` |
| `placeGroup(options?)` | Créer une entité d'ancrage transform uniquement — retourne `PlaceHandle<void>` |
| `placePrefab(def, options?)` | Placer une entité prefab — retourne `PlaceHandle<void>` |
| `useLayout(def, options?)` | Obtenir le handle de contrôle du layout (`{ lazy }` pour différer le chargement, `{ chunkSize }` pour spawner progressivement) |
| `layout.load()` | Activer le layout (`Promise<void>`) |
| `layout.dispose()` | Désactiver le layout (`Promise<void>`) |
| `layout.active` | `true` si le layout est chargé |
| `layout.refs` | Record typé des handles placés |
| `handle.api` | API publique de l'acteur |
| `handle.moveTo([x, y])` | Repositionner l'entité |
| `handle.despawn()` | Despawner cette entité |

## Étapes suivantes

- **[Scènes](/fr/essentials/scenes)** — Comment les scènes fonctionnent avec les layouts.
- **[Acteurs](/fr/essentials/actors)** — Construire les acteurs d'UI placés dans votre layout.
- **[Prefabs](/fr/essentials/prefabs)** — Définir la disposition des composants pour vos acteurs.
