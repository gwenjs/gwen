---
title: Prefabs
description: Les prefabs définissent la disposition des composants d'une entité. Ce sont les blueprints de données sur lesquels les acteurs s'appuient.
---

# Prefabs

Un **prefab** définit la disposition des composants d'une entité — quels composants elle possède et leurs valeurs initiales. L'usage habituel est de le passer comme premier argument à `defineActor` : le prefab déclare la forme des données, l'acteur y ajoute des hooks de cycle de vie et une API publique.

::: info Auto-imports
Dans un projet GWEN, `definePrefab` et `usePrefab` sont auto-importés — aucune ligne `import` nécessaire.
:::

## Définir un prefab

Utilisez `definePrefab()` pour déclarer un modèle d'entité réutilisable :

```ts
import { Position, Velocity, Health } from './components'

export const EnemyPrefab = definePrefab([
  { def: Position, defaults: { x: 0, y: 0 } },
  { def: Velocity, defaults: { vx: 0, vy: 0 } },
  { def: Health,   defaults: { current: 50, max: 50 } },
])
```

:::tip Les noms de champs sont importants
Les surcharges de `spawn()` sont un merge **flat** appliqué à tous les composants. Si deux composants partagent le même nom de champ (ex. les deux ont `x`), une seule surcharge impacte les deux. Utilisez des noms distincts entre composants — `x`/`y` pour la position, `vx`/`vy` pour la vélocité — pour que les surcharges soient sans ambiguïté.
:::

## Utiliser un prefab dans un acteur

Passez le prefab comme premier argument à `defineActor`. L'acteur obtient des hooks de cycle de vie, une API publique et un contrôle complet du spawn/despawn — c'est la façon standard de donner vie à un prefab :

```ts
import { EnemyPrefab } from './prefabs'

export const EnemyActor = defineActor(EnemyPrefab, (props: { x: number; y: number }) => {
  const health = useComponent(Health)

  onStart(() => {
    useTransform().setPosition(props.x, props.y)
  })

  onUpdate(() => {
    // mouvement, IA, etc.
  })

  return {
    takeDamage: (n: number) => { health.current -= n },
    getHp: () => health.current,
  }
})
```

Puis dans une scène, générez des instances via le handle de l'acteur :

```ts
export const GameScene = defineScene('game', () => {
  const enemy = useActor(EnemyActor)

  onEnter(() => {
    enemy.spawn({ x: 400, y: 300 })
    enemy.spawn({ x: 600, y: 200 })
  })

  onExit(() => enemy.despawnAll())
})
```

Voir [Acteurs](/fr/essentials/actors) pour l'API complète des acteurs.

## Surcharges de spawn

Lors du spawn, passez des surcharges pour définir les valeurs de champs de cette instance. Les surcharges sont mergées shallow dans les defaults de chaque composant — seuls les champs passés changent :

```ts
// Position surchargée, Health reste aux defaults
enemy.spawn({ x: 200, y: 300 })

// Surcharger la position et donner plus de santé à cet ennemi
enemy.spawn({ x: 100, y: 100, current: 100, max: 100 })

// Utiliser tous les defaults du prefab
enemy.spawn()
```

::: tip Defaults du composant vs defaults du prefab
`defineComponent` accepte un champ `defaults` pour des valeurs par défaut au niveau du composant. Les `defaults` du prefab les remplacent, et les valeurs passées à `spawn()` remplacent tout. La chaîne de priorité est : arguments de `spawn()` → defaults du prefab → defaults du composant.
:::

## Spawn direct avec `usePrefab`

Pour les entités qui sont des données pures — pas de cycle de vie, pas d'API publique, interrogées uniquement par des systèmes — vous pouvez utiliser `usePrefab()` directement pour obtenir un handle de spawn bas niveau :

```ts
import { ObstaclePrefab } from './prefabs'

// Dans une factory d'acteur ou de système :
const obstacle = usePrefab(ObstaclePrefab)
const id = obstacle.spawn({ x: 100, y: 200 })
obstacle.despawn(id)
```

C'est un escape hatch pour des cas comme la géométrie statique d'une carte ou l'initialisation de données. **Pour tout ce qui a du rendu, du mouvement ou un cycle de vie, enveloppez-le dans un acteur.**

## Résumé de l'API

| Fonction | Description |
|---|---|
| `definePrefab(components)` | Déclarer une disposition de composants |
| `defineActor(prefab, factory)` | Envelopper un prefab avec cycle de vie et API publique — usage principal |
| `usePrefab(PrefabDef)` | Handle de spawn bas niveau (sans cycle de vie) |
| `handle.spawn(overrides?)` | Créer une entité, retourne l'ID d'entité |
| `handle.despawn(id)` | Supprimer une entité générée |

## Étapes suivantes

- **[Acteurs](/fr/essentials/actors)** — Ajoutez un cycle de vie, une logique de mise à jour et une API publique à votre prefab.
- **[Scènes](/fr/essentials/scenes)** — Enregistrez et contrôlez les acteurs depuis une scène.
- **[Systèmes](/fr/essentials/systems)** — Écrivez une logique par lot sur toutes les entités correspondant aux composants d'un prefab.
