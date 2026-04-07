---
title: Mode debug
description: Visualiser l'état du moteur, les colliseurs et le minutage du système.
---

# Mode debug

Le mode debug active les diagnostics visuels et console pour comprendre ce qui se passe à l'intérieur du moteur. Lorsqu'il est activé, GWEN affiche les wireframes de colliseurs, les superpositions de minutage du système et la journalisation structurée—vous aidant à diagnostiquer les problèmes de performance et à valider la logique.

## Activer le mode debug

### Debug global du moteur

Définissez `engine.debug: true` dans `gwen.config.ts` pour activer le mode debug global. Cela active :
- Journalisation détaillée de l'enregistrement des plugins et des événements de cycle de vie
- Vérifications sentinelles par frame
- Avertissements de timing de phase en cas de dépassement du budget de frame

```typescript
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  engine: {
    debug: true,
  },
})
```

### Debug de module

Les modules individuels peuvent aussi exposer leur propre option `debug` via le tuple de module :

```typescript
export default defineConfig({
  modules: [['@gwenjs/physics2d', { debug: true }]],
})
```

Cela active le rendu de débogage physique (superposition des formes de collision), indépendamment du flag de debug global du moteur.

## Les bases

Activez le mode debug dans votre configuration du moteur :

```ts
// gwen.config.ts
export default defineConfig({
  modules: [['@gwenjs/physics2d', { debug: true }]],
})
```

Quand `debug: true` :
- Les colliseurs de physique s'affichent comme des wireframes colorés
- Le minutage du système apparaît à l'écran
- La journalisation détaillée est active
- Les vérifications de sentinelle valident l'intégrité des données

## Débogage visuel

### Visualisation des colliseurs

Avec le mode debug activé, les corps de physique sont dessinés avec des wireframes :

```ts
// Physics affiche automatiquement les colliseurs quand debug: true
const world = usePhysics2D()
// Tous les boîtes, cercles et polygones sont maintenant visibles
```

Les couleurs indiquent le type de corps :
- **Bleu** — Corps statiques (immobiles)
- **Vert** — Corps dynamiques
- **Jaune** — Corps cinématiques (contrôlés par le joueur)
- **Rouge** — Corps en sommeil

### Superposition de minutage du système

GWEN affiche le temps d'exécution par système en millisecondes :

```
[FRAME 1248] (dt: 16.7ms)
├─ MovementSystem        2.1ms
├─ PhysicsSystem         4.8ms
├─ CollisionSystem       1.3ms
├─ RenderSystem         11.2ms
└─ Total                19.4ms (16% over budget)
```

Cela aide à identifier les goulots d'étranglement. Si un système dépasse régulièrement son budget (par exemple, la physique prenant 5ms sur une image de 16ms), vous avez trouvé un problème de performance.

## Statistiques du moteur

Accédez aux données de performance par frame via `engine.getStats()` :

```typescript
const stats = engine.getStats()

console.log(stats.fps)           // FPS actuel
console.log(stats.deltaTime)     // delta de la dernière frame en ms
console.log(stats.frameCount)    // total de frames depuis le démarrage
console.log(stats.budgetMs)      // budget de frame (1000 / targetFPS)
console.log(stats.overBudget)    // true si la dernière frame a dépassé le budget

// Décomposition par phase (toutes en ms)
const p = stats.phaseMs
console.log(p.tick)       // hook engine:tick
console.log(p.plugins)    // appels onBeforeUpdate()
console.log(p.physics)    // étape physics2d/3d
console.log(p.wasm)       // étapes des modules WASM
console.log(p.update)     // appels onUpdate()
console.log(p.render)     // appels onAfterUpdate() + onRender()
console.log(p.afterTick)  // hook engine:afterTick
console.log(p.total)      // temps total de la frame
```

> **Note :** Utilisez `engine.getStats()` — et non `engine.stats`. C'est un appel de méthode.

## Journalisation structurée

GWEN fournit un logger intégré via `createLogger()`. Niveaux de log : `debug` < `info` < `warn` < `error`. Chaque entrée est un objet `LogEntry` structuré, compatible avec des sinks de logs personnalisés.

```typescript
import { createLogger } from '@gwenjs/core'

const logger = createLogger('MyPlugin')

logger.debug('initializing...')
logger.info('plugin started')
logger.warn('slow frame detected', { frameMs: 32 })
logger.error('unhandled error', error)
```

Utilisez-le à l'intérieur d'un système avec accès au contexte d'initialisation :

```ts
import { createLogger, defineSystem, useEngine } from '@gwenjs/core'

export const MySystem = defineSystem(() => {
  const engine = useEngine()
  const log = createLogger('game:my-system', engine.debug)

  onStart(() => {
    log.info('System initialized', { entityCount: 42 })
    log.debug('Detailed initialization data', { config: {...} })
  })

  onUpdate(() => {
    if (someWarning) {
      log.warn('Unexpected state detected', { state: 'foo' })
    }
  })
})
```

### Niveaux de journalisation

Le journal respecte le drapeau `debug` :

| Niveau | Quand actif | Utilisation |
|---|---|---|
| `debug` | Uniquement quand `debug: true` | Diagnostics détaillés (désactivé en production) |
| `info` | Uniquement quand `debug: true` | Événements informationnels |
| `warn` | Toujours | Conditions inattendues mais récupérables |
| `error` | Toujours | Problèmes qui nécessitent une attention |

Cela signifie que vos appels `log.debug()` sont des no-ops en production, évitant les surcharges.

### Puits de journalisation personnalisés

Redirigez les journaux vers un puits personnalisé (par exemple, un serveur, un service externe ou un espion de test) :

```ts
import { createLogger } from '@gwenjs/core'

const log = createLogger('app:core', true)

// Remplacer le puits de console par défaut
log.setSink((entry) => {
  console.log(`[${entry.level.toUpperCase()}] ${entry.source}: ${entry.message}`)
  if (entry.data) {
    console.table(entry.data)
  }

  // Transmettre à l'analyse
  if (entry.level === 'error') {
    analytics.logError(entry.source, entry.message, entry.data)
  }
})

log.error('Critical issue', { userId: 123, errorCode: 'LOAD_FAILED' })
```

## Fonctionnalités conditionnelles

### Débogage basé sur l'environnement

Utilisez `process.env.NODE_ENV` pour activer les fonctionnalités de débogage uniquement pendant le développement :

```ts
// gwen.config.ts
export default defineConfig({
  engine: {
    debug: process.env.NODE_ENV !== 'production',
  },
  modules: [['@gwenjs/physics2d', {}]],
})
```

Maintenant :
- Les versions de développement (`npm run dev`) ont `debug: true`
- Les versions de production (`npm run build`) ont `debug: false`

### Enregistrement de système conditionnel

Enregistrez les systèmes réservés au debug :

```ts
import { defineScene } from '@gwenjs/core/scene'

export class GameScene extends defineScene {
  onLoad() {
    this.addSystem(GameplaySystem)

    if (import.meta.env.DEV) {
      this.addSystem(DebugVisualizationSystem)
      this.addSystem(PerformanceProfilingSystem)
    }
  }
}
```

### Basculement de debug à l'exécution

Permettre aux joueurs de basculer les visuels de debug dans le jeu :

```ts
import { useEngine, defineSystem, onUpdate } from '@gwenjs/core'

export const DebugToggleSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyPressed('F1')) {
      engine.config.debug = !engine.config.debug
    }
  })
})
```

## En pratique

### Profiler un problème de performance

Vous avez remarqué des baisses de fréquence d'images. Le mode debug aide :

1. **Activez le mode debug :**
   ```ts
   debug: true
   ```

2. **Exécutez le jeu et observez la superposition de minutage.** Remarquez que `PhysicsSystem` monte à 8ms quand beaucoup d'ennemis sont à l'écran.

3. **Vérifiez la journalisation du système :**
   ```ts
   const log = createLogger('game:physics', engine.debug)
   onUpdate(() => {
     log.debug('Physics step', { bodyCount: physics.bodyCount() })
   })
   ```

4. **Analysez les journaux.** Vous découvrez que le nombre de corps passe de 10 à 200 quand les ennemis apparaissent, et les performances se dégradent.

5. **Correction :** Réduire le nombre de corps de physique actifs ou utiliser le partitionnement spatial.

### Validation des collisions

Les wireframes de colliseur aident à vérifier la géométrie de collision :

```ts
import { defineScene } from '@gwenjs/core/scene'
import { Position, Collider } from './components'

export class TestScene extends defineScene {
  onLoad() {
    // Créer une entité avec un colliseur
    const id = createEntity()
    Position.set(id, { x: 100, y: 100 })
    Collider.set(id, { type: 'box', w: 50, h: 50 })

    // En mode debug, le colliseur s'affiche visuellement
    // Vous pouvez immédiatement voir si le colliseur est correctement positionné/dimensionné
  }
}
```

### Filtrage des journaux lors des tests

Redirigez les journaux vers un espion de test :

```ts
import { createLogger } from '@gwenjs/core'
import { describe, it, expect } from 'vitest'

describe('MySystem', () => {
  it('logs initialization', () => {
    const messages: string[] = []
    const log = createLogger('test:system', true)
    log.setSink((entry) => messages.push(entry.message))

    // ... exécuter la configuration du système ...

    expect(messages).toContain('System initialized')
  })
})
```

## Sous le capot

### Impact sur les performances

Le mode debug a une surcharge mesurable :
- Rendu des colliseurs : ~1–2ms par image
- Superposition de minutage : <0,1ms
- Journalisation structurée : Négligeable si filtrée à l'exécution

Utilisez `import.meta.env.DEV` pour désactiver toute surcharge en production.

### Vérifications de sentinelle

Quand `debug: true`, GWEN effectue une validation supplémentaire :
- Les tableaux de composants sont vérifiés aux limites
- Les ID d'entités sont vérifiés pour exister
- La disposition de la mémoire WASM est inspectée pour la corruption

Ces vérifications détectent les bogues tôt mais ajoutent ~5–10% de surcharge.

## Résumé de l'API

| Fonction | Description |
|---|---|
| `defineConfig({ debug })` | Activer/désactiver le mode debug |
| `createLogger(source, debugMode)` | Créer une instance de journal |
| `logger.debug(msg, data?)` | Journaliser uniquement quand le mode debug est activé |
| `logger.info(msg, data?)` | Journal informatif (debug uniquement) |
| `logger.warn(msg, data?)` | Journal d'avertissement (toujours actif) |
| `logger.error(msg, data?)` | Journal d'erreur (toujours actif) |
| `logger.child(source)` | Créer un journal enfant avec portée |
| `logger.setSink(callback)` | Rediriger les journaux vers un puits personnalisé |
| `import.meta.env.DEV` | Drapeau Vite pour les versions de développement |

## Prochaines étapes

- **[Bus d'erreurs](/fr/advanced/error-bus)** — Gestion structurée des erreurs aux côtés de la journalisation.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui se connectent et se profilent efficacement.
