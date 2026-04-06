---
title: Le moteur
description: Créer et configurer l'instance du moteur GWEN et comment il gère la boucle de jeu.
---

# Le moteur

Le **moteur GWEN** est le runtime qui démarre votre jeu, charge WASM, gère les scènes et exécute vos systèmes chaque frame. La configuration du moteur se fait en deux endroits : **`gwen.config.ts`** (à la compilation) et **`main.ts`** (au démarrage).

## Configuration en deux parties

### Partie 1 : Configuration à la compilation — `gwen.config.ts`

Utilisez `defineConfig()` depuis `@gwenjs/app` pour déclarer les modules, la variante WASM et les paramètres de compilation :

```ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],        // Active le module physique
  engine: {
    maxEntities: 10_000,                  // Configuration du moteur (optionnelle)
    variant: 'physics2d',                 // Variante WASM
  },
})
```

Le fichier de configuration est traité **à la compilation** par Vite et configure la résolution des modules.

### Partie 2 : Démarrage au runtime — `main.ts`

Dans votre point d'entrée, importez et créez le moteur **séparément** :

```ts
import { createEngine } from '@gwenjs/core'
import { Physics2DPlugin } from '@gwenjs/physics2d'
import { AppRouter } from './router'

const engine = await createEngine({
  maxEntities: 10_000,
  variant: 'physics2d',
})

// Installer les plugins
await engine.use(Physics2DPlugin())

// Installer le routeur de scènes
await engine.use(AppRouter)

// Démarrer la boucle de jeu
await engine.start()
```

**Distinction clé :** `createEngine()` accepte `GwenEngineOptions` (paramètres au runtime), PAS `GwenUserConfig`. Ce sont des APIs complètement séparées.

## Configuration à la compilation : `GwenUserConfig`

Utilisée **uniquement dans `gwen.config.ts`**. Configure les modules, la variante WASM et les crochets de compilation.

| Propriété | Type | Description |
|---|---|---|
| `modules` | `GwenModuleEntry[]` | Liste des modules à activer (ex. : `['@gwenjs/physics2d']`) |
| `engine.maxEntities` | `number` | Nombre maximal d'entités simultanées (par défaut 10_000) |
| `engine.targetFPS` | `number` | FPS cibles (par défaut 60) |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | Variante WASM à charger |
| `engine.loop` | `'internal' \| 'external'` | Propriétaire de la boucle de jeu (par défaut 'internal') |
| `engine.maxDeltaSeconds` | `number` | Delta temps max par frame (par défaut 0.1s) |
| `vite` | `Record<string, unknown>` | Extension directe de la configuration Vite |
| `hooks` | `Partial<GwenBuildHooks>` | Souscriptions aux crochets de compilation |
| `plugins` | `GwenPlugin[]` | Enregistrement direct de plugins (porte de secours) |

**Exemple :**
```ts
export default defineConfig({
  modules: [
    '@gwenjs/physics2d',
    ['@gwenjs/input', { gamepad: true }],
  ],
  engine: {
    maxEntities: 5_000,
    targetFPS: 60,
    variant: 'physics2d',
  },
  vite: {
    // Configuration Vite directe
  },
})
```

## Configuration au runtime : `GwenEngineOptions`

Utilisée dans **`createEngine()`** au runtime. Configure l'instance du moteur.

| Propriété | Type | Description |
|---|---|---|
| `maxEntities` | `number` | Nombre maximal d'entités simultanées |
| `targetFPS` | `number` | Images par seconde cibles |
| `variant` | `'light' \| 'physics2d' \| 'physics3d'` | Variante WASM |
| `debug` | `boolean` | Activer les logs de débogage et les vérifications |
| `enableStats` | `boolean` | Collecter les statistiques de performance (par défaut true) |
| `sparseTransformSync` | `boolean` | Ne synchroniser que les transformations modifiées (par défaut true) |
| `loop` | `'internal' \| 'external'` | Mode de boucle de jeu (par défaut 'internal') |
| `maxDeltaSeconds` | `number` | Delta max par frame (par défaut 0.1s) |
| `tweenPoolSize` | `number` | Slots de tween pré-alloués (par défaut 256) |

**Exemple :**
```ts
const engine = await createEngine({
  maxEntities: 10_000,
  targetFPS: 60,
  variant: 'physics2d',
  debug: true,
  loop: 'internal',
})
```

## Mode boucle interne vs externe

Par défaut, GWEN gère `requestAnimationFrame`. Utilisez `loop: 'external'` pour contrôler la boucle vous-même :

```ts
// Mode boucle interne (par défaut)
const engine = await createEngine({ loop: 'internal' })
await engine.start()

// Mode boucle externe
const engine = await createEngine({ loop: 'external' })
function gameLoop(delta: number) {
  engine.advance(delta)
  requestAnimationFrame(gameLoop)
}
requestAnimationFrame(gameLoop)
```

## Installation de plugins et routeurs

Après la création, installez les plugins et routeurs avant d'appeler `engine.start()` :

```ts
const engine = await createEngine({ variant: 'physics2d' })

// Installer un plugin
await engine.use(Physics2DPlugin())

// Installer un routeur de scènes
await engine.use(AppRouter)

// Démarrer la boucle de jeu
await engine.start()
```

## Accéder au moteur dans les systèmes

À l'intérieur de la fonction de configuration d'un système, utilisez `useEngine()` pour accéder à l'instance du moteur :

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    // Exécuter chaque frame
  })
})
```

Depuis le moteur, vous pouvez :

- Obtenir les **statistiques** — `engine.getStats()` (fps, frameCount, entityCount, etc.)
- **Créer/détruire des entités** — `engine.spawn()`, `engine.destroy()`
- Accéder aux **plugins** — `engine.getPlugin(PhysicsPlugin)`
- **Contrôler la boucle** — `engine.pause()`, `engine.resume()`, `engine.advance(delta)` (mode externe)

## Cycle de vie du moteur

Quand vous appelez `engine.start()` :

1. **Initialisation** — Configurer la mémoire WASM, les systèmes internes
2. **Configuration des plugins** — Appeler la configuration sur chaque plugin monté
3. **Entrée dans la scène initiale** — Charger le premier état du routeur ou de la scène
4. **Boucle de jeu** — Chaque frame :
   - Appeler `onUpdate(dt)` sur tous les systèmes
   - Mettre à jour les composants
   - Rendu (si un canvas est attaché)
   - Simulation physique (si le plugin Physics est monté)

## Tâches courantes du moteur

### Obtenir les statistiques du moteur

```ts
const stats = engine.getStats()
console.log(`FPS: ${stats.fps}`)
console.log(`Entités: ${stats.entityCount}`)
console.log(`Delta: ${stats.deltaTime}s`)
```

### Mettre en pause et reprendre

```ts
engine.pause()
engine.resume()
```

### Boucle externe (avancé)

```ts
const engine = await createEngine({ loop: 'external' })

let lastTime = performance.now()
function tick(now: number) {
  const delta = (now - lastTime) / 1000  // Convertir en secondes
  lastTime = now
  engine.advance(delta)
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)
```

## Résumé de l'API

| Fonction | Retour | Description |
|---|---|---|
| `createEngine(options)` | `Promise<GwenEngine>` | Créer et initialiser le moteur |
| `engine.use(plugin)` | `Promise<void>` | Installer un plugin ou un routeur |
| `engine.start()` | `Promise<void>` | Démarrer la boucle de jeu |
| `engine.pause()` | `void` | Mettre en pause la boucle de jeu |
| `engine.resume()` | `void` | Reprendre la boucle de jeu |
| `engine.advance(delta)` | `void` | Avancer manuellement d'une frame (mode boucle externe) |
| `engine.getStats()` | `EngineStats` | Obtenir les métriques de performance |
| `engine.spawn(components)` | `number` | Créer une nouvelle entité |
| `engine.destroy(id)` | `void` | Supprimer une entité |
| `useEngine()` | `GwenEngine` | Accéder au moteur depuis l'intérieur d'un système |

## Prochaines étapes

- **[Composants](/fr/essentials/components)** — Définir les structures de données pour vos entités.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes pour déplacer et mettre à jour les entités.
- **[Scènes](/fr/essentials/scenes)** — Organiser votre jeu en états distincts.
- **[Acteurs](/essentials/actors)** — Créer des objets de jeu composables basés sur des instances.
