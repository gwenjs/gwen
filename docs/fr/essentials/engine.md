---
title: Le moteur
description: Créer et configurer l'instance du moteur GWEN et comment il gère la boucle de jeu.
---

# Le moteur

Le **moteur GWEN** est le runtime qui démarre votre jeu, charge WASM, gère les scènes et exécute vos systèmes chaque frame. La configuration du moteur se fait dans **`gwen.config.ts`** à la compilation — vous ne démarrez jamais le moteur manuellement.

## Configuration à la compilation — `gwen.config.ts`

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

## Accéder au moteur dans les systèmes

À l'intérieur de la fonction de configuration d'un système, utilisez `useEngine()` pour accéder à l'instance du moteur :

```ts
import { defineSystem, onUpdate } from '@gwenjs/core/system'
import { useEngine } from '@gwenjs/core'

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

Quand le jeu démarre :

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

## Résumé de l'API

| Fonction | Retour | Description |
|---|---|---|
| `engine.pause()` | `void` | Mettre en pause la boucle de jeu |
| `engine.resume()` | `void` | Reprendre la boucle de jeu |
| `engine.advance(delta)` | `void` | Avancer manuellement d'une frame (mode boucle externe) |
| `engine.getStats()` | `EngineStats` | Obtenir les métriques de performance |
| `engine.spawn(components)` | `number` | Créer une nouvelle entité |
| `engine.destroy(id)` | `void` | Supprimer une entité |
| `useEngine()` | `GwenEngine` | Accéder au moteur depuis l'intérieur d'un système |

## Étendre Vite

GWEN gère votre configuration Vite en interne — vous n'avez pas besoin d'un fichier `vite.config.ts`. Pour l'étendre, utilisez le champ `vite` dans `gwen.config.ts` :

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  vite: {
    resolve: {
      alias: { '~assets': './src/assets' },
    },
  },
})
```

Pour les crochets de compilation, utilisez le champ `hooks` :

Utilisez `vite` pour une configuration statique. Utilisez `hooks['vite:extendConfig']` pour une configuration conditionnelle ou programmatique.

```typescript
export default defineConfig({
  hooks: {
    'vite:extendConfig': (config) => {
      config.resolve ??= {}
      config.resolve.alias = { '~assets': './src/assets' }
    },
  },
})
```

Pour les modèles d'extension Vite complets (y compris l'extension au niveau des modules), voir [Étendre Vite](/fr/advanced/vite-config).

## Prochaines étapes

- **[Composants](/fr/essentials/components)** — Définir les structures de données pour vos entités.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes pour déplacer et mettre à jour les entités.
- **[Scènes](/fr/essentials/scenes)** — Organiser votre jeu en états distincts.
- **[Acteurs](/fr/essentials/actors)** — Créer des objets de jeu composables basés sur des instances.
