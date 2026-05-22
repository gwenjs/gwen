---
title: Patterns de performance
description: Trois patterns critiques pour écrire des jeux GWEN performants — architecture hybride acteur/système, code partagé, et l'optimiseur ECS au build time.
---

# Patterns de performance

GWEN est conçu pour que **le code idiomatique soit du code rapide**. L'optimiseur Vite au
build time et l'architecture ECS font le gros du travail. Mais trois patterns déterminent si
votre jeu passe à l'échelle ou plante à 100+ entités.

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

Chaque actor exécute son propre `onUpdate`. Cinq cents ennemis signifie cinq cents callbacks
indépendants — le moteur ne peut pas les regrouper et la localité de cache est perdue.

### Le pattern

Utilisez les actors pour **l'identité** (spawn, configuration, API publique). Utilisez les
systems pour **la logique en masse** (déplacement, IA, réponse aux collisions).

```ts
// ✅ Actor — possède l'entité et expose l'API
export const EnemyActor = defineActor(EnemyPrefab, () => {
  const speed = useComponent(self.id, Enemy)

  return {
    setSpeed(v: number) { speed.value = v },
  }
})

// ✅ System — traite tous les ennemis en un seul passage
export const EnemyMovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Enemy])

  onUpdate((dt) => {
    for (const entity of entities) {
      const pos = useComponent(entity.id, Position)
      const enemy = useComponent(entity.id, Enemy)
      pos.x += enemy.speed * dt
    }
  })
})
```

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

---

## 2. Code partagé entre system et actor

### Le piège

Un system traite les entités en masse ; un actor en possède une. Quand les deux ont besoin de
la même logique (ex. calculer des dégâts), le réflexe est de dupliquer le code ou de recourir
à une hiérarchie de classes.

### Pattern A — Fonctions pures

Extrayez la logique dans une fonction simple sans dépendance ECS. L'actor et le system l'appellent.

```ts
// shared/damage.ts — pas d'ECS, pas de composables, juste des données
export function computeDamage(base: number, multiplier: number, armor: number): number {
  return Math.max(0, base * multiplier - armor)
}

// Dans le system — passage en masse
onUpdate(() => {
  for (const entity of entities) {
    const stats = useComponent(entity.id, Stats)
    stats.hp -= computeDamage(stats.attack, 1.2, stats.armor)
  }
})

// Dans l'actor — entité unique
const damage = computeDamage(myStats.attack, comboMultiplier, targetArmor)
```

Les fonctions pures sont cache-friendly, facilement testables et sans dépendance GWEN.

### Pattern B — Service partagé via `useService`

Quand l'état partagé est runtime (pas du calcul pur), enregistrez-le comme service dans un
plugin et consommez-le des deux côtés.

```ts
// Le plugin enregistre le service
definePlugin({
  setup(engine) {
    const scoreBoard = createScoreBoard()
    engine.provide('scoreBoard', scoreBoard)
  }
})

// Le system le lit
export const ScoreSystem = defineSystem(() => {
  const board = useService('scoreBoard')
  onUpdate(() => { /* mettre à jour le board depuis les données des entités */ })
})

// L'actor le lit aussi
export const HUDActor = defineActor(HUDPrefab, () => {
  const board = useService('scoreBoard')
  onUpdate(() => { renderScore(board.total) })
})
```

`useService` se résout une seule fois au setup — zéro overhead dans `onUpdate`.

---

## 3. Optimiseur ECS au build time

### Comment ça fonctionne

Le plugin Vite de GWEN analyse vos systems au build time et transforme le pattern proxy
ergonomique `useComponent` en appels WASM en masse — automatiquement, sans modifier votre code.

**Vous écrivez :**

```ts
export const MovementSystem = defineSystem(() => {
  const entities = useQuery([Position, Velocity])

  onUpdate((dt) => {
    for (const entity of entities) {
      const pos = useComponent(entity.id, Position)
      const vel = useComponent(entity.id, Velocity)
      pos.x += vel.x * dt
      pos.y += vel.y * dt
    }
  })
})
```

**L'optimiseur produit :**

```ts
// queryReadBulk : un appel WASM pour charger toutes les données Position + Velocity
const { entityCount: _count_position, data: _position, slots: _slots, gens: _gens } =
  __gwen_bridge__.queryReadBulk([1, 2], 1, 2);
const { data: _velocity } =
  __gwen_bridge__.queryReadBulk([1, 2], 2, 2);

for (let _i = 0; _i < _count_position; _i++) {
  _position[_i * 2 + 0] += _velocity[_i * 2 + 0] * dt   // pos.x += vel.x * dt
  _position[_i * 2 + 1] += _velocity[_i * 2 + 1] * dt   // pos.y += vel.y * dt
}

// queryWriteBulk : un appel WASM pour réécrire toutes les mutations
__gwen_bridge__.queryWriteBulk(_slots, _gens, 1, _position);
```

N entités, 2 champs chacune → **2 appels WASM au total** au lieu de N × nb-champs appels
individuels. Le gain devient mesurable à partir de ~100+ entités.

### Ce que l'optimiseur détecte

L'optimiseur reconnaît exactement cette forme dans une factory `defineSystem` :

```ts
const entities = useQuery([ComponentA, ComponentB])   // tableau littéral d'identifiants

onUpdate((dt) => {
  for (const entity of entities) {
    const a = useComponent(entity.id, ComponentA)     // lecture 2-arg
    const b = useComponent(entity.id, ComponentB)     // lecture 2-arg
    a.field += b.field * dt                           // mutation proxy → cible d'écriture
  }
})
```

Contraintes — l'optimiseur ignore un pattern quand :

| Contrainte | Raison |
|---|---|
| Tous les champs de composant doivent être numériques (`f32`, `i32`, `u32`, …) | Les buffers WASM en masse sont des typed arrays |
| Un seul `for-of` par `onUpdate` | Les systems multi-boucles ne sont pas encore fusionnés |
| Tous les composants doivent être dans le manifest au build time | Le scanner lit `defineComponent` depuis `src/` |
| Le tableau `useQuery` doit être un littéral d'identifiants | Les tableaux dynamiques ne peuvent pas être pré-calculés |

### Activer l'optimiseur

```ts
// vite.config.ts  (ou gwen.config.ts → champ vite)
import { gwenVitePlugin, gwenOptimizerPlugin } from '@gwenjs/vite'

export default {
  plugins: [
    gwenVitePlugin(),
    gwenOptimizerPlugin({ mode: 'transform' }),  // 'detect' pour auditer, 'transform' pour réécrire
  ]
}
```

Utilisez `mode: 'detect'` d'abord pour voir quels systems sont optimisables avant d'activer les réécritures.

### Règles du hot path

Indépendamment de si l'optimiseur s'applique, respectez ces règles dans `onUpdate` :

```ts
onUpdate((dt) => {
  for (const entity of entities) {
    // ✅ Proxy useComponent — ergonomique et optimisable
    const pos = useComponent(entity.id, Position)
    pos.x += vel.x * dt

    // ❌ addComponent / removeComponent — changement d'archétype, réallocation de buffer
    // engine.addComponent(entity.id, NewTag, {})

    // ❌ async — le contexte moteur est perdu après await, onUpdate est synchrone
    // await fetch('/api/state')

    // ❌ nouvelles allocations d'objets par entité — pression GC
    // const v = new Vec2(pos.x, pos.y)   utilisez les helpers sans allocation de @gwenjs/math
  }
})
```

## Résumé

| Pattern | Règle |
|---|---|
| Beaucoup d'entités | System, pas actor |
| Logique pure partagée | Fonction simple, sans dépendance ECS |
| État runtime partagé | `engine.provide` / `useService` |
| Itération en masse | Proxy `useComponent(entity.id, Def)` — l'optimiseur fait le reste |
| Dans `onUpdate` | Pas de `addComponent`, pas d'`async`, pas d'allocations `new` |
