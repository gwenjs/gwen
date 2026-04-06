---
title: Bus d'erreurs
description: Signalement d'erreurs structuré et non fatal dans tout le moteur.
---

# Bus d'erreurs

Le bus d'erreurs de GWEN fournit un moyen structuré pour le moteur, les plugins et le code du jeu d'émettre et de gérer les erreurs avec élégance. Au lieu de lancer des exceptions (qui arrêtent le jeu), les erreurs sont émises comme des événements que votre code peut écouter et sur lesquels il peut agir—gardant le jeu en cours d'exécution même en cas de problème.

## Les bases

Accédez au bus d'erreurs via le moteur :

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const ErrorHandlingSystem = defineSystem(() => {
  const engine = useEngine()

  // Écoutez les erreurs émises par le moteur ou les plugins
  engine.errors.on((error) => {
    console.warn(`[${error.level}] ${error.code}: ${error.message}`)

    if (error.level === 'fatal') {
      // Effectuer le nettoyage ou afficher un écran d'erreur
      showErrorDialog(error.message)
    }
  })
})
```

Le bus d'erreurs émet des événements avec une structure cohérente :

```ts
interface ErrorEvent {
  level: 'fatal' | 'error' | 'warning' | 'info' | 'verbose'
  code: string           // par exemple, 'CORE:FRAME_LOOP_ERROR'
  message: string        // Description lisible
  source?: string        // Quel plugin a émis ceci
  error?: unknown        // L'objet Error sous-jacent, le cas échéant
  context?: Record<string, unknown>  // Données de débogage supplémentaires
}
```

## Écoute des erreurs

Enregistrez un gestionnaire qui reçoit tous les événements d'erreur :

```ts
engine.errors.on((event) => {
  if (event.code === 'PHYSICS:INVALID_SHAPE') {
    // Gérer les formes de physique invalides spécifiquement
    rebuildPhysicsWorld()
  }

  if (event.level === 'error') {
    // Journaliser vers le service de télémétrie
    analytics.logError(event.code, event.context)
  }
})
```

### Codes d'erreur de base

Le moteur émet des erreurs en utilisant `CoreErrorCodes` :

```ts
import { CoreErrorCodes } from '@gwenjs/core'

// Codes disponibles :
CoreErrorCodes.FRAME_LOOP_ERROR     // Quelque chose s'est mal passé lors de l'avancement de l'image
CoreErrorCodes.PLUGIN_NOT_FOUND     // Plugin demandé mais non enregistré
CoreErrorCodes.WASM_LOAD_ERROR      // Le module WASM n'a pas pu se charger
CoreErrorCodes.CONTEXT_ERROR        // useX() appelé en dehors du contexte valide
```

Les plugins définissent leurs propres codes d'erreur en suivant le même modèle : `'PLUGIN_NAME:ERROR_TYPE'`.

## Émission d'erreurs

Les plugins et le code du jeu peuvent émettre des erreurs structurées au lieu de lancer :

```ts
import { defineSystem, useEngine } from '@gwenjs/core'

export const CustomSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (invalidState) {
      engine.errors.emit({
        level: 'warning',
        code: 'GAME:INVALID_STATE',
        message: 'Entity has conflicting components',
        source: 'game:validation',
        context: {
          entityId: entity.id,
          components: ['Health', 'DeadTag'],
        }
      })
    }
  })
})
```

En émettant au lieu de lancer :
- La boucle de jeu continue sans interruption
- Les autres systèmes se mettent toujours à jour
- Les gestionnaires peuvent décider comment répondre (journaliser, alerter, récupérer)
- Plusieurs erreurs peuvent s'accumuler et être signalées ensemble

## Pourquoi ne pas lancer ?

Lancer des exceptions arrête immédiatement le jeu. Dans un jeu en direct, cela signifie :
- Les joueurs voient un écran figé
- Aucune récupération n'est possible
- La télémétrie est perdue

Avec le bus d'erreurs :
- Le jeu reste réactif
- Votre gestionnaire d'erreurs peut tenter une récupération (redémarrer un sous-système, recharger une scène)
- Les événements d'erreur sont structurés pour la télémétrie (Sentry, Datadog, analyses personnalisées)
- Les joueurs reçoivent un message d'erreur utile, pas un plantage

## En pratique

### Récupération gracieuse de défaillance physique

La physique est coûteuse en termes de calcul et peut échouer. Au lieu de planter, émettez et récupérez :

```ts
import { usePhysics2D, useEngine } from '@gwenjs/core'

export const PhysicsSystem = defineSystem(() => {
  const physics = usePhysics2D()
  const engine = useEngine()

  onUpdate(() => {
    try {
      physics.step(dt)
    } catch (err) {
      engine.errors.emit({
        level: 'error',
        code: 'PHYSICS:STEP_FAILED',
        message: 'Physics step exceeded CPU budget',
        source: 'game:physics',
        error: err,
        context: { dt, bodyCount: physics.bodyCount() }
      })

      // Tenter une récupération : réduire la qualité de simulation
      physics.setSubsteps(1)
    }
  })
})
```

### Télémétrie des erreurs

Transmettre les erreurs à votre backend d'analyses :

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const TelemetrySystem = defineSystem(() => {
  const engine = useEngine()

  engine.errors.on((event) => {
    // Signaler uniquement les erreurs et au-dessus
    if (['error', 'fatal'].includes(event.level)) {
      fetch('/api/errors', {
        method: 'POST',
        body: JSON.stringify({
          timestamp: Date.now(),
          code: event.code,
          message: event.message,
          level: event.level,
          context: event.context,
          stacktrace: event.error instanceof Error
            ? event.error.stack
            : undefined
        })
      })
    }
  })
})
```

### Récupération d'erreur fatale

Lorsqu'une erreur fatale se produit, affichez un dialogue d'erreur et rechargez éventuellement :

```ts
engine.errors.on((event) => {
  if (event.level === 'fatal') {
    showErrorDialog({
      title: 'Game Error',
      message: event.message,
      code: event.code,
      onRetry: () => location.reload(),
      onMenu: () => loadScene('MainMenu')
    })
  }
})
```

## Sous le capot

### Niveaux d'erreur

- **`verbose`** — Diagnostics extrêmement détaillés (uniquement dans les versions de débogage)
- **`info`** — Événements informationnels (par exemple, « Physique initialisée avec 42 corps »)
- **`warning`** — Quelque chose d'inattendu mais récupérable
- **`error`** — Un problème qui nécessite une attention
- **`fatal`** — Le moteur ne peut pas continuer ; récupération requise

### Gestionnaire d'erreur fatale

Enregistrez un rappel qui s'exécute avant qu'une erreur fatale soit levée :

```ts
engine.errors.onFatal(() => {
  // Nettoyage : sauvegarder l'état du jeu, se déconnecter du serveur, etc.
  saveGameState()
  disconnectNetwork()
})
```

Ceci s'exécute de manière synchrone, avant que le gestionnaire d'erreurs ne soit invoqué.

### Installation

GWEN peut installer des gestionnaires d'erreurs globaux :

```ts
engine.errors.install?.()
```

Ceci attache des gestionnaires aux événements `window.onerror` et `unhandledrejection`, en transmettant les erreurs non interceptées au bus d'erreurs.

## Résumé de l'API

| Méthode | Description |
|---|---|
| `engine.errors.emit(event)` | Émettre un événement d'erreur structuré |
| `engine.errors.on(handler)` | Enregistrer un rappel d'écouteur d'erreur |
| `engine.errors.onFatal(cb)` | Exécuter le nettoyage avant une erreur fatale |
| `engine.errors.install?.()` | Installer les gestionnaires d'erreurs globaux |

## Prochaines étapes

- **[Mode debug](/fr/advanced/debug-mode)** — Voir et filtrer les erreurs dans la superposition de débogage.
- **[Journalisation](/fr/advanced/debug-mode)** — Utilisez la journalisation structurée aux côtés du signalement d'erreurs.
- **[Architecture](/fr/essentials/architecture)** — Comprendre comment la récupération d'erreurs s'intègre dans la conception du système.
