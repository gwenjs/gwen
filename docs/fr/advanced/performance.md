---
title: Patterns de performance
description: Trois patterns critiques pour écrire des jeux GWEN performants — architecture hybride acteur/système, code partagé, et l'optimiseur ECS au build time.
---

# Patterns de performance

GWEN est conçu pour que **le code idiomatique soit du code rapide**. L'optimiseur Vite au
build time et l'architecture ECS font le gros du travail.

## 1. Architecture hybride acteur / système

### Le piège

En venant de React ou Vue, le réflexe est de tout mettre dans des actors — ils ressemblent à
`<script setup>` et semblent naturels. Pour les objets uniques (joueur, boss, HUD) c'est le
bon choix. Pour les entités en masse, non.

```ts
// ❌ 500 ennemis — 500 callbacks onUpdate séparés, aucun gain ECS
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const transform = useTransform()

  onUpdate((dt) => {
    transform.x += 100 * dt   // un callback par entité, cache non optimisé
  })
})
```

Chaque actor exécute son propre `onUpdate`.

### Le pattern

Utilisez les actors pour **l'identité** (spawn, configuration, API publique). Utilisez les
systems pour **la logique en masse** (déplacement, IA, réponse aux collisions).

| Utilisez un actor quand | Utilisez un system quand |
|---|---|
| Un objet unique (joueur, caméra, HUD) | Beaucoup d'objets identiques (ennemis, balles, particules) |
| Vous avez besoin d'une API publique nommée | Vous avez besoin d'un seul passage sur N entités |
| L'état est propre à l'instance | La logique est identique pour chaque entité |

### Câblage dans une scène

```ts
export const GameScene = defineScene('game', () => {
  useSystem(EnemyMovementSystem)

  const enemies = useActor(EnemyActor)
  onEnter(() => {
    for (let i = 0; i < 500; i++) enemies.spawn()
  })
})
```

Le system itère toutes les entités en un seul passage continu. Les actors les font spawner/despawner.
Ni l'un ni l'autre ne se connaît.

## 2. Code partagé entre system et actor

### Le piège

Un system traite les entités en masse ; un actor en possède une. Quand les deux ont besoin de
la même logique (ex. calculer des dégâts), le réflexe est de dupliquer le code ou de recourir
à une hiérarchie de classes.

### Pattern A — Fonctions pures

Extrayez la logique dans une fonction simple sans dépendance ECS. L'actor et le system l'appellent.

```ts
export function computeDamage(base: number, multiplier: number, armor: number): number {
  return Math.max(0, base * multiplier - armor)
}

const damage = computeDamage(myStats.attack, comboMultiplier, targetArmor)
```

Les fonctions pures sont cache-friendly, facilement testables et sans dépendance GWEN.

### Pattern B — Service partagé via `useService`

Quand l'état partagé est runtime (pas du calcul pur), enregistrez-le comme service dans un
plugin et consommez-le des deux côtés.

```ts
definePlugin({
  setup(engine) {
    const scoreBoard = createScoreBoard()
    engine.provide('scoreBoard', scoreBoard)
  }
})

export const ScoreSystem = defineSystem(() => {
  const board = useService('scoreBoard')
  onUpdate(() => { /* mettre à jour le board depuis les données des entités */ })
})

export const HUDActor = defineActor(HUDPrefab, () => {
  const board = useService('scoreBoard')
  onUpdate(() => { renderScore(board.total) })
})
```

## Résumé

| Pattern | Règle |
|---|---|
| Beaucoup d'entités | System, pas actor |
| Logique pure partagée | Fonction simple, sans dépendance ECS |
| État runtime partagé | `engine.provide` / `useService` |
| Dans `onUpdate` | Pas de `addComponent`, pas d'`async`, pas d'allocations `new` |
