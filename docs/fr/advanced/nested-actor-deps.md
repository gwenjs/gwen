---
title: Dépendances d'acteurs imbriqués
description: Comment GWEN enregistre automatiquement les plugins d'acteurs enfants déclarés dans un factory defineActor(), et comment agir sans Vite.
---

# Dépendances d'acteurs imbriqués

Quand un acteur gère d'autres acteurs — un `BulletManagerActor` qui spawn des
`BulletActor`, par exemple — `useActor()` est appelé dans le corps du factory :

```ts
export const BulletManagerActor = defineActor(BulletManagerPrefab, () => {
  const bullet = useActor(BulletActor)  // ← dépendance sur BulletActor

  onEvent('player:shoot', (x, y) => {
    bullet.spawn({ x, y })
  })

  return {}
})
```

Sans traitement particulier, le plugin de `BulletActor` ne serait jamais
installé : `useActor()` dans un factory d'acteur s'exécute au moment du
**spawn** (dans `onEnter`), après la fermeture du contexte de scène. Appeler
`bullet.spawn()` lèverait alors une erreur `ACTOR:PLUGIN_NOT_READY`.

## Résolution automatique avec `@gwenjs/vite`

Quand `@gwenjs/vite` est configuré (via `gwenVitePlugin()`), cela est géré
automatiquement à la compilation. Le plugin Vite analyse statiquement chaque
factory `defineActor` et injecte une liste `_deps` sur le plugin résultant :

```ts
// Ce que le transform Vite génère — vous n'écrivez jamais cela à la main :
BulletManagerActor._plugin._deps = [BulletActor._plugin]
```

Au runtime, quand `useActor(BulletManagerActor)` est appelé dans un factory de
scène, GWEN lit `_deps` et enregistre également le plugin de `BulletActor` —
avant le bootstrap de la scène.

**Aucun changement de code n'est nécessaire.** Déclarez simplement
`BulletManagerActor` dans la scène comme d'habitude :

```ts
export const GameScene = defineScene('game', () => {
  const manager = useActor(BulletManagerActor)  // BulletActor enregistré automatiquement
  // ✅ Inutile d'écrire aussi : useActor(BulletActor)

  onEnter(() => manager.spawnOnce())
  onExit(() => manager.despawnAll())
})
```

## Limitations

### Les appels `useActor` dynamiques ne sont pas détectés

Le transform ne reconnaît que les arguments **identifiants statiques**. Pour
les valeurs dynamiques, vous devez déclarer la dépendance manuellement dans la
scène :

```ts
// ❌ Non détecté — déclarez BulletActor dans la scène manuellement
const actor = useActor(list[index])

// ✅ Détecté
const bullet = useActor(BulletActor)
```

### Sans `@gwenjs/vite`

Dans les environnements sans le transform Vite (scripts Node.js purs, setups
de test non-Vite), `_deps` n'est jamais défini. Déclarez explicitement tous
les acteurs requis dans le factory de scène :

```ts
export const GameScene = defineScene('game', () => {
  useActor(BulletManagerActor)
  useActor(BulletActor)  // ← déclaration explicite sans le transform Vite
  // ...
})
```

### Dépendances transitives au-delà de la profondeur 1

Si `A` dépend de `B` qui dépend de `C`, et que seul `A` est déclaré dans la
scène, `B` est auto-enregistré mais pas `C`. Déclarez `A` et `B` dans la
scène, ou ajoutez un `useActor(C)` explicite.

## Patron acteur-gestionnaire

Cette fonctionnalité est conçue pour le **patron acteur-gestionnaire** : un
acteur singleton léger dont le seul rôle est d'écouter des événements et de
spawner/despawner d'autres acteurs. Le gestionnaire est l'interface publique ;
l'acteur géré est un détail d'implémentation.

```ts
// actors/laser-manager.ts
export const LaserManagerActor = defineActor(LaserManagerPrefab, () => {
  const laser = useActor(LaserActor)  // LaserActor enregistré automatiquement

  onEvent('player:shoot', (x, y) => laser.spawn({ x, y }))

  return {}
})

// scenes/game.ts — déclarez uniquement le gestionnaire
export const GameScene = defineScene('game', () => {
  const manager = useActor(LaserManagerActor)

  onEnter(() => manager.spawnOnce())
  onExit(() => manager.despawnAll())
})
```
