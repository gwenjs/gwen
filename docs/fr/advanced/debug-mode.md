---
title: Mode debug
description: Visualiser l'état du moteur, les colliseurs et le minutage du système.
---

# Mode debug

Le mode debug active les diagnostics visuels et console pour comprendre ce qui se passe à l'intérieur du moteur. Lorsqu'il est activé, GWEN affiche les wireframes de colliseurs, les superpositions de minutage du système et la journalisation structurée—vous aidant à diagnostiquer les problèmes de performance et à valider la logique.

## Activer le mode debug

### Debug global du moteur

Définissez `engine.debug: true` dans `gwen.config.ts` pour activer le mode debug global. Les logs `debug` et `info` suivent ce drapeau dans chaque build. Ceci ne tourne que si `__GWEN_DEV__` est aussi vrai :
- Vérifications sentinelles par frame
- Avertissements de timing de phase en cas de dépassement du budget de frame
- L'avertissement d'isolation (`isolated after …`)

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

Les modules individuels peuvent aussi exposer leur propre option `debug`. Définissez-la à la clé de configuration top-level du module :

```typescript
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: { debug: true },
})
```

Cela active le rendu de débogage physique (superposition des formes de collision), indépendamment du flag de debug global du moteur.

## Les bases

Activez le mode debug dans votre configuration du moteur :

```ts
// gwen.config.ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: { debug: true },
})
```

Quand `debug: true` :
- Les colliseurs de physique s'affichent comme des wireframes colorés
- Le minutage du système apparaît à l'écran
- La journalisation détaillée est active
- La sentinelle de mémoire WASM n'est vérifiée que si `__GWEN_DEV__` est aussi vrai. Les tableaux de composants ne sont pas vérifiés aux bornes, et les ID d'entités ne sont pas vérifiés.

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

console.log(stats.fps)              // FPS lissé à partir de la frame brute
console.log(stats.rawFrameTime)     // durée de frame en secondes, sans plafond ni timeScale
console.log(stats.deltaTime)        // dernier pas en secondes, après le plafond et timeScale
console.log(stats.frameCount)       // frames terminées
console.log(stats.entityCount)      // entités vivantes à cet appel
console.log(stats.budgetMs)         // budget de frame (1000 / targetFPS)
console.log(stats.wasmMemoryBytes)  // octets de mémoire linéaire, ou undefined
console.log(stats.overBudget)       // présent seulement si __GWEN_DEV__ && debug

// Décomposition par phase (toutes en ms). Présente seulement si __GWEN_DEV__ et debug sont vrais.
const p = stats.phaseMs
if (p) {
  console.log(p.tick)       // engine:tick
  console.log(p.plugins)    // engine:before-update, y compris le pas physique et la synchro cinématique
  console.log(p.wasm)       // pas des modules WASM communautaires
  console.log(p.update)     // update_transforms et engine:update
  console.log(p.render)     // engine:after-update et engine:render
  console.log(p.afterTick)  // engine:afterTick
  console.log(p.total)      // tout _runFrame
}
```

Avec `physicsHz > 0`, une frame d'affichage peut exécuter plusieurs pas de simulation. `getStats()` additionne ces pas dans chaque champ de `phaseMs`. `total` couvre ces pas. `frameCount` compte les pas. `engine:render` tourne encore une fois par pas, donc `phaseMs.render` est la somme de ces passages.

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
import { createLogger, useEngine } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

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

### Le debug reste éteint tant que vous ne le mettez pas

`engine.debug` vaut `false` par défaut. Le serveur de développement ne l'active pas.

`__GWEN_DEV__` est le drapeau de build. Sur un build, il suit le mode Vite, pas `NODE_ENV`. `vite build` (mode `production`) le met à `false`. `vite build --mode development` le met à `true` : un build de développement garde toutes les vérifications. Avec `vite` / `vite dev`, il suit `import.meta.env.DEV` de Vite, qui vaut `true`. `import.meta.env.DEV` de Vite suit `NODE_ENV`, et `vite build` met `NODE_ENV` à `production` par défaut quand il n'est pas défini : il reste `false` sur `vite build --mode development` ([Vite : NODE_ENV and Modes](https://vite.dev/guide/env-and-mode#node-env-and-modes)). Migration : `NODE_ENV=development vite build` (ou `NODE_ENV=development` dans `.env`) donne maintenant `false` ; passez `--mode development` à la place. Un mode autre que `development` (par exemple `staging`) donne `false`. `GWEN_DEV` de `virtual:gwen/env` a la même valeur que `__GWEN_DEV__`. Le minutage par frame et la sentinelle mémoire WASM ne tournent que si `__GWEN_DEV__` et `debug` sont vrais.

### Enregistrement de système conditionnel

Enregistrez les systèmes réservés au debug :

```ts
import { defineScene } from '@gwenjs/core/scene'

export class GameScene extends defineScene {
  onLoad() {
    this.addSystem(GameplaySystem)

    if (__GWEN_DEV__) {
      this.addSystem(DebugVisualizationSystem)
      this.addSystem(PerformanceProfilingSystem)
    }
  }
}
```

### Basculement de debug à l'exécution

Permettre aux joueurs de basculer les visuels de debug dans le jeu :

```ts
import { useEngine } from '@gwenjs/core'
import { defineSystem } from '@gwenjs/core/system'

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

Les builds de production (`__GWEN_DEV__ === false`) retirent les avertissements réservés au dev et l'instrumentation par frame, même si `debug` vaut `true`. Les logs `debug` et `info` suivent toujours `engine.debug`.

### Vérifications de sentinelle

Quand `__GWEN_DEV__` et `debug: true`, GWEN vérifie la sentinelle de mémoire WASM après chaque frame. Il ne vérifie pas les bornes des tableaux de composants et il ne vérifie pas que les ID d'entités existent. Cette vérification est absente des builds de production.

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
| `__GWEN_DEV__` | Drapeau de build. `true` en dev, `false` en production |

## Prochaines étapes

- **[Détection de leaks d'acteurs](/fr/advanced/actor-leak-detection)** — Détecter la croissance non bornée d'acteurs avec `watchActorLeaks`.
- **[Bus d'erreurs](/fr/advanced/error-bus)** — Gestion structurée des erreurs aux côtés de la journalisation.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes qui se connectent et se profilent efficacement.
