---
title: Le moteur
description: Créer et configurer l'instance du moteur GWEN et comment il gère la boucle de jeu.
---

# Le moteur

Le **moteur GWEN** est le runtime qui démarre votre jeu, charge WASM, gère le graphe de scène et exécute vos systèmes chaque frame. Ce guide vous montre comment créer un moteur, le configurer et y accéder depuis vos systèmes.

## Les bases

### Créer un moteur

D'abord, définissez votre configuration, puis créez le moteur :

```ts
import { createEngine } from '@gwenjs/core'
import { defineConfig } from '@gwenjs/app'
import { Physics2DPlugin } from '@gwenjs/physics2d'

import MainScene from './scenes/main'
import MenuScene from './scenes/menu'

const config = defineConfig({
  plugins: [Physics2DPlugin()],
  scenes: {
    main: MainScene,
    menu: MenuScene,
  },
  initialScene: 'main',
})

const engine = createEngine(config)
await engine.start()
```

### Options de configuration

| Option | Type | Description |
|---|---|---|
| `plugins` | `Plugin[]` | Plugins à charger (ex. : physique, rendu, réseau) |
| `scenes` | `Record<string, SceneClass>` | Carte du nom de scène à la classe |
| `initialScene` | `string` | Nom de la scène à charger au démarrage |
| `wasm` | `WasmModule` | (optionnel) Module WASM personnalisé (par défaut gwen_core.wasm) |
| `logger` | `Logger` | (optionnel) Instance de logger personnalisée |
| `debug` | `boolean` | (optionnel) Activer le mode debug (logs, gizmos, etc.) |

### Cycle de vie du moteur

Quand vous appelez `engine.start()`, voici ce qui se passe dans l'ordre :

1. **Boot** — Charger le module WASM, initialiser les systèmes internes
2. **Montage des plugins** — Appeler `mount()` sur chaque plugin
3. **Chargement de scène** — Charger la scène initiale, créer ses acteurs
4. **Initialisation des acteurs** — Appeler `onStart()` sur chaque acteur de la scène
5. **Initialisation des systèmes** — Appeler les callbacks `onStart()` dans chaque système
6. **Boucle de jeu** — Chaque frame :
   - Appeler `onUpdate(dt)` sur chaque système
   - Rendu
   - Simulation physique (si le plugin Physics2D est chargé)
7. **Déchargement de scène** — En changeant de scène, appeler `onDestroy()` sur les acteurs et systèmes
8. **Démontage des plugins** — Appeler `unmount()` sur chaque plugin

## Accéder au moteur dans les systèmes

À l'intérieur de la fonction de configuration d'un système, utilisez le hook `useEngine()` pour accéder à l'instance du moteur :

```ts
import { defineSystem, useEngine, onUpdate } from '@gwenjs/core'

export const InputSystem = defineSystem(() => {
  const engine = useEngine()

  onUpdate(() => {
    if (engine.input.isKeyDown('ArrowLeft')) {
      // Gérer l'entrée
    }
  })
})
```

Depuis le moteur, vous pouvez :

- Accéder à la **scène courante** — `engine.currentScene`
- **Créer/détruire des entités** — `engine.spawn()`, `engine.destroy()`
- Accéder aux **plugins** — `engine.getPlugin(PhysicsPlugin)`
- **Changer de scène** — `engine.loadScene('menu')`
- Accéder à l'**état d'entrée** — `engine.input`

## Accéder au moteur dans les composants et acteurs

À l'intérieur d'un **acteur** (nœud de scène), vous pouvez accéder au moteur via le contexte de l'acteur :

```ts
import { Actor } from '@gwenjs/core'

export class Player extends Actor {
  onStart() {
    const engine = this.scene.engine
    this.scene.spawn(/* ... */)
  }
}
```

## Gérer le démarrage et l'arrêt

Utilisez `mount()` et `unmount()` du plugin pour l'initialisation et le nettoyage :

```ts
import { Plugin } from '@gwenjs/core'

export class MyPlugin extends Plugin {
  mount(engine) {
    console.log('Le jeu démarre !')
    // Initialiser les bibliothèques externes, charger les ressources, etc.
  }

  unmount(engine) {
    console.log('Le jeu s\'arrête !')
    // Nettoyer : déconnecter les sockets, arrêter les serveurs, etc.
  }
}
```

## Tâches courantes du moteur

### Changer de scène

```ts
const engine = useEngine()
engine.loadScene('menu')
```

### Obtenir une instance de plugin

```ts
import { Physics2DPlugin } from '@gwenjs/physics2d'

const engine = useEngine()
const physics = engine.getPlugin(Physics2DPlugin)
```

### Créer une entité

```ts
const engine = useEngine()
const entityId = engine.spawn([
  [Position, { x: 10, y: 20 }],
  [Velocity, { x: 1, y: 0 }],
])
```

## Résumé de l'API

| Fonction/Propriété | Retour | Description |
|---|---|---|
| `createEngine(config)` | `GwenEngine` | Créer un moteur à partir d'une configuration |
| `engine.start()` | `Promise<void>` | Démarrer le moteur, charger WASM, monter les plugins, entrer dans la scène initiale |
| `engine.loadScene(name)` | `Promise<void>` | Charger une nouvelle scène |
| `engine.spawn(components)` | `number` | Créer une nouvelle entité |
| `engine.destroy(id)` | `void` | Supprimer une entité |
| `engine.currentScene` | `Scene` | La scène active |
| `engine.input` | `InputState` | État du clavier/souris actuel |
| `engine.getPlugin(PluginClass)` | `T` | Récupérer une instance de plugin par classe |
| `useEngine()` | `GwenEngine` | Accéder au moteur depuis la configuration d'un système |

## Prochaines étapes

- **[Composants](/fr/essentials/components)** — Définir les structures de données pour vos entités.
- **[Systèmes](/fr/essentials/systems)** — Écrire des systèmes pour déplacer et mettre à jour les entités.
- **[Scènes et acteurs](/fr/essentials/scenes)** — Comprendre le graphe de scène et le système de préfabriqué.
