---
title: Créer un plugin personnalisé
description: Comment créer et enregistrer un plugin GWEN personnalisé avec @gwenjs/kit.
---

# Créer un plugin personnalisé

Un **plugin** est un objet TypeScript conforme à l'interface `GwenPlugin`. Vous créez des plugins en utilisant `definePlugin()` depuis `@gwenjs/kit`, qui retourne une fonction factory que vous pouvez personnaliser avec des options.

## Les bases

### Plugin simple

Voici un plugin de gestion d'entrée basique :

```ts
// Exemple de plugin
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (key: string) => boolean }
  }
}

const keys = new Set<string>()

export const InputPlugin = definePlugin({ provides: ['input'] }, () => ({
  name: 'input',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })

    // Expose un service aux systèmes
    engine.provide('input', {
      isKeyDown: (key: string) => keys.has(key),
    })
  },
}))
```

### Plugin avec options

Acceptez la configuration lors de l'instanciation du plugin :

```ts
// Exemple de plugin
declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: {
      isKeyDown: (key: string) => boolean
      isKeyPressed: (key: string) => boolean
    }
  }
}

interface InputOptions {
  repeatDelay: number
  preventDefault: string[] // Keys to prevent default on
}

const inputDefaults: InputOptions = { repeatDelay: 50, preventDefault: [] }

export const InputPlugin = definePlugin(
  { provides: ['input'], options: { defaults: inputDefaults } },
  (opts) => {
    const { repeatDelay, preventDefault } = opts
    const keys = new Set<string>()
    const lastRepeat = new Map<string, number>()

    return {
      name: 'input',
      setup(engine) {
        engine.hooks.hook('engine:init', () => {
          window.addEventListener('keydown', (e) => {
            if (preventDefault.includes(e.key)) e.preventDefault()
            keys.add(e.key)
          })
          window.addEventListener('keyup', (e) => keys.delete(e.key))
        })

        engine.provide('input', {
          isKeyDown: (key: string) => keys.has(key),
          isKeyPressed: (key: string) => {
            if (!keys.has(key)) return false
            const now = Date.now()
            const last = lastRepeat.get(key) ?? now - repeatDelay
            if (now - last >= repeatDelay) {
              lastRepeat.set(key, now)
              return true
            }
            return false
          },
        })
      },
    }
  },
)
```

### Déclarer des services et des options

Le premier argument de `definePlugin` déclare les services que le plugin fournit et les options qu'il accepte. Il y a trois formes :

```ts
declare module '@gwenjs/schema' {
  interface GwenProvides {
    clock: { now(): number }
    gravity: { value: number }
  }
}

// 1. Ni services ni options : la factory seule
export const Bare = definePlugin(() => ({ name: 'bare', setup() {} }))

// 2. Des services, sans options
export const Clock = definePlugin({ provides: ['clock'] }, () => ({
  name: 'clock',
  setup(engine) {
    engine.provide('clock', { now: () => performance.now() })
  },
}))

// 3. Des options, avec ou sans services (`provides` peut valoir `[]`)
export const Gravity = definePlugin(
  { provides: ['gravity'], options: { defaults: { value: -9.8 } } },
  (opts) => ({
    name: 'gravity',
    setup(engine) {
      engine.provide('gravity', { value: opts.value })
    },
  }),
)

const plugin = Gravity({ value: -20 })
```

- Chaque clé de `provides` doit être une clé de `GwenProvides` et pas une clé du moteur (`logger`, `errors`, `wasm:bridge`, `memory`). Dans `setup`, `engine.provide` n'accepte que les clés déclarées, à la compilation. `provides` peut être une fonction des options résolues, `(opts) => [...]`.
- `options.defaults` donne la forme résolue et chaque valeur par défaut. La factory reçoit un objet gelé : `defaults` fusionné sur un niveau avec l'argument de l'appelant. Une clé que l'appelant met à `undefined` garde sa valeur par défaut. Un objet imbriqué passé par l'appelant remplace l'objet imbriqué par défaut en entier. Les types refusent un `undefined` explicite, sauf si le type de l'option l'inclut.
- `options.validate` est une fonction pure optionnelle qui retourne des `GwenConfigIssue[]`. La factory ne l'appelle jamais et ne lève jamais d'erreur pour des options invalides. Le plugin expose le résultat via `plugin.validateOptions()`, et `plugin.provides` contient les clés dédupliquées et gelées.
- `provides`, `validateOptions` et `extensionApi` dans l'objet que la factory retourne sont des erreurs de type : `definePlugin` les écrit.
- `engine.use()` vérifie la déclaration à l'exécution, aussi pour un objet plugin brut. `validateOptions()` passe en premier : des problèmes rejettent avec `CORE:PLUGIN_OPTIONS_INVALID`, `setup()` n'est pas appelé et rien n'arrive sur `engine.errors`. Une clé déclarée que tient déjà un plugin installé ou en cours d'installation, ou le moteur, rejette avec `CORE:PLUGIN_PROVIDE_DUPLICATE` ; un second fournisseur n'écrase plus le premier. `engine.provide` sur l'argument `engine` de `setup()` lève `CORE:PLUGIN_PROVIDE_UNDECLARED` pour une clé hors de `provides`, et un plugin sans `provides` ne peut rien fournir. Quand `setup()` se termine sans toutes les clés déclarées, `use()` rejette avec `CORE:PLUGIN_PROVIDE_MISSING` et le plugin est retiré. `engine.provide` sur le moteur lui-même ne change pas.

### Déclarer une API d'extension

Une base pose `extensionApi: { major, minor }` sur le premier argument de `definePlugin`. C'est la version de sa surface d'extension, pas la version du paquet. `definePlugin` la copie sur le plugin comme propriété énumérable et gelée. Ne la mettez pas dans le retour de la factory.

Une extension nomme cette base avec `{ name, extensionApi }` dans `requires.plugins`. Une entrée objet a besoin d'une entrée du registre avec `extensionApi`, de même majeur. `isExtensionApiCompatible(required, actual)` est le contrôle que fait `engine.use` : `actual` est défini, les majeurs sont égaux, et `actual.minor` est supérieur ou égal au mineur requis.

La base crée un registre par moteur dans `setup`, et n'appelle les callbacks que par `invokeEach`. `register(owner, item)` retourne un disposer idempotent. L'extension le passe à `onCleanup`. Un item qui lance émet une erreur au nom de son propriétaire, cet enregistrement est disposé, et les items suivants s'exécutent.

```ts
import { createExtensionRegistry, definePlugin, isExtensionApiCompatible } from '@gwenjs/kit/plugin'
import type { ExtensionRegistry } from '@gwenjs/kit/plugin'
import type { GwenExtensionService } from '@gwenjs/schema'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    'widgets:extension': GwenExtensionService
  }
  interface GwenPluginRegistry {
    widgets: { readonly extensionApi: { readonly major: 1; readonly minor: 0 } }
  }
}

export const Widgets = definePlugin(
  { provides: ['widgets:extension'], extensionApi: { major: 1, minor: 0 } },
  () => ({
    name: 'widgets',
    setup(engine) {
      const presets: ExtensionRegistry<{ id: string }> = createExtensionRegistry({ name: 'presets' })
      engine.provide('widgets:extension', {
        extensionApi: { major: 1, minor: 0 },
        get registrations() {
          return presets.size
        },
      })
    },
  }),
)

const fits = isExtensionApiCompatible({ major: 1, minor: 0 }, { major: 1, minor: 2 })
```

### Enregistrer un plugin

Il existe deux façons d'enregistrer un plugin dans GWEN. Pour les plugins locaux et spécifiques au projet, déposez un fichier dans `src/plugins/` — aucune configuration nécessaire. Pour les plugins qui ont besoin d'options de `gwen.config.ts`, encapsulez-les dans un module local dans `src/modules/`.

Voir [Plugin local (auto-découverte)](#plugin-local-auto-découverte) ci-dessous pour les détails complets et les contraintes.

## Plugin local (auto-découverte)

La façon la plus simple d'ajouter un plugin à votre projet : déposez un fichier `.ts` dans `src/plugins/`. GWEN découvre tous les fichiers du répertoire alphabétiquement et les enregistre automatiquement après `config.plugins`.

### Exemple minimal

```ts
// src/plugins/analytics.ts
import { definePlugin } from '@gwenjs/kit/plugin'

export default definePlugin(() => ({
  name: 'analytics',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      console.log('[analytics] session démarrée')
    })
  },
}))
```

Deux règles pour les plugins locaux :
1. **`export default`** — pas un export nommé. Le framework importe l'export par défaut.
2. **Factory, pas instance** — exportez le résultat de `definePlugin(...)`, pas le résultat de son appel.

### Patterns d'enregistrement

**Option A — Plugin sans config externe (déposer dans `src/plugins/`) :**

```ts
// src/plugins/input.ts
import { definePlugin } from '@gwenjs/kit/plugin'

declare module '@gwenjs/schema' {
  interface GwenProvides {
    input: { isKeyDown: (key: string) => boolean }
  }
}

const keys = new Set<string>()

export default definePlugin({ provides: ['input'] }, () => ({
  name: 'input',
  setup(engine) {
    engine.hooks.hook('engine:init', () => {
      window.addEventListener('keydown', (e) => keys.add(e.key))
      window.addEventListener('keyup', (e) => keys.delete(e.key))
    })
    engine.provide('input', {
      isKeyDown: (key: string) => keys.has(key),
    })
  },
}))
```

**Option B — Plugin avec options de `gwen.config.ts` (utiliser un module local) :**

```ts
// src/modules/input.ts
import { defineGwenModule } from '@gwenjs/kit/module'

interface InputOptions {
  repeatDelay?: number
  preventDefault?: string[]
}

declare module '@gwenjs/schema' {
  interface GwenModuleOptions {
    input?: InputOptions
  }
}

export default defineGwenModule<InputOptions>({
  meta: { name: 'local:input', configKey: 'input' },
  defaults: { repeatDelay: 50, preventDefault: [] },
  setup(options, gwen) {
    gwen.addPlugin({ src: "./src/plugins/input", options })
  },
})
```

Configurer dans `gwen.config.ts` :

```ts
// gwen.config.ts
import { defineConfig } from '@gwenjs/app'

export default defineConfig({
  input: { preventDefault: ['ArrowUp', 'ArrowDown'] },
})
```

### Quand utiliser un module local à la place

| Besoin | Solution |
|---|---|
| Plugin sans config | `src/plugins/mon-plugin.ts` |
| Plugin avec options de `gwen.config.ts` | `src/modules/mon-plugin.ts` encapsulant le plugin |

Voir [Créer un module personnalisé](/fr/kit/custom-module) pour l'approche module.

### Rechargement à chaud en dev

L'ajout ou la suppression d'un fichier dans `src/plugins/` déclenche un rechargement complet de la page en mode dev. La modification d'un fichier existant utilise le HMR normal de Vite — pas de rechargement requis.

### Contraintes

::: warning Fichiers plats uniquement
`src/plugins/audio.ts` ✅ — `src/plugins/audio/index.ts` ❌. Les sous-répertoires ne sont pas scannés.
:::

## Cycle de vie du plugin

Chaque plugin reçoit une fonction `setup()` qui s'exécute une fois lors de l'initialisation du moteur, avant le chargement de toute scène.

### Hooks disponibles

```ts
export const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    // Called once during engine init
    // Register services, event listeners, etc.

    engine.hooks.hook('engine:init', () => {
      // Called by engine.start(), after every plugin is set up
      // Safe to use engine features here
    })

    engine.hooks.hook('engine:stop', () => {
      // Called before engine shutdown
      // Cleanup listeners, free resources
    })
  },

  teardown() {
    // Appelé par engine.unuse() et engine.stop(), après le retrait des services de ce plugin.
  },
}))
```

## Les callbacks de frame sont des hooks

`engine.use()` rejette un plugin qui déclare un callback de frame. Le code est `CORE:PLUGIN_INVALID_SHAPE`. Enregistrez le hook dans `setup()`. Seules les clés propres sont vérifiées.

| Clé | Hook |
| --- | --- |
| `onBeforeUpdate` | `engine:before-update` |
| `onUpdate` | `engine:update` |
| `onAfterUpdate` | `engine:after-update` |
| `onRender` | `engine:render` |
| `onStart` | `engine:start` |
| `onStop` | `engine:stop` |
| `onDestroy` | `engine:stop` |

```ts
setup(engine) {
  engine.hooks.hook('engine:update', (dt) => {
    // dt est en secondes
  })
}
```

Dans un build de développement avec `debug: true`, une clé propre autre que `name`, `setup`, `teardown`, `onError`, `requires`, `provides`, `validateOptions` ou `extensionApi`, et qui ne commence pas par `_`, produit un avertissement et est ignorée.

Les mêmes clés échouent à la compilation. `definePlugin` remplace chaque clé hors `name`, `setup`, `teardown`, `onError` et `requires` par un message `PluginKeyError`. Une clé en trop dans l'objet retourné est donc une erreur de type. Déclarez les options dans le premier argument, `definePlugin({ provides: [], options: { defaults } }, (opts) => ...)`. Laissez l'inférence trouver les arguments de type : le type des options vient de `options.defaults`.

## Teardown

`engine.unuse(name)` et `engine.stop()` appellent `teardown()`. `stop()` l'appelle après le hook `engine:stop`, dans l'ordre inverse d'installation. Un teardown doit être idempotent avec le travail déjà fait sur `engine:stop`. Les services fournis via l'argument `engine` de `setup()`, y compris après la résolution de `setup()`, sont retirés avant `teardown()`. `useEngine().provide(...)` n'est pas retiré. Remplacer une clé du moteur (`wasm:bridge`, `logger`, `errors`, `memory`) ne la fait pas retirer par `stop()` ou `unuse()`.

## Requirements

Un plugin nomme ce qui doit déjà être installé. `engine.use()` vérifie `requires` avant `setup()`. GWEN ne réordonne pas ces exigences et ne les installe pas à votre place.

```ts
declare module '@gwenjs/schema' {
  interface GwenPluginRegistry { input: {} }
}

export const GamePlugin = definePlugin(() => ({
  name: 'game',
  requires: {
    plugins: ['input'],
    services: ['logger'],
  },
  setup(engine) {
    engine.inject('logger')
  },
}))
```

Les `plugins` sont vérifiés d'abord, puis les `services`, chacun dans l'ordre écrit. Un service que le moteur fournit déjà (`wasm:bridge`, `logger`, `errors`, `memory`) compte comme installé. Un plugin dont `setup()` est encore en cours ne compte pas.

Si un nom manque, `engine.use()` rejette `GwenPluginDependencyError` avec le code `CORE:PLUGIN_DEPENDENCY_MISSING` et n'appelle pas `setup()`. Appeler `use()` une seconde fois avec un nom déjà installé réussit. Dans un build de développement avec `debug: true`, un avertissement est aussi écrit.

`optional` nomme des services qui peuvent être absents. `use()` ne les vérifie pas. `unuse()` ne les compte pas comme dépendants.

## Services optionnels

Lisez un service optionnel avec `optionalService` ou `tryInject`. Les deux sont typés par `GwenProvides`. `tryInject` renvoie `GwenProvides[K] | undefined`. Aucun des deux ne lance si la clé est absente.

```ts
import { optionalService } from "@gwenjs/kit/plugin";

const logger = optionalService(engine, "logger");
logger.current?.warn("prêt");
```

`watchService(key, onChange)` s'abonne pendant `setup()` et appelle `onChange` avec la valeur actuelle. Un remplacement appelle `onChange` avec la valeur encore stockée. Un retrait appelle `onChange(undefined)`. La fonction renvoyée arrête l'abonnement. Retirer le plugin l'arrête aussi.

`service:provided` et `service:removed` portent `{ key, value, owner, reason }`. `reason` vaut `install`, `unuse`, `stop` ou `overwrite`. Lors d'un remplacement, `service:removed` nomme l'ancien propriétaire et `service:provided` nomme le plugin qui a stocké la nouvelle valeur. Les clés du moteur (`wasm:bridge`, `logger`, `errors`, `memory`) ne déclenchent pas ces hooks. Les `provide` du plugin pendant `setup()` sont annoncés après la résolution de `setup()` et avant `plugin:registered`, et seulement si toutes les clés déclarées sont présentes. Un `setup()` en échec, un `provide` non déclaré ou une clé déclarée manquante n'annonce rien. Un `provide` d'une clé déclarée après la résolution de `setup()` est annoncé tout de suite.

## Fournir des services

Utilisez `engine.provide()` pour enregistrer un service que les systèmes peuvent accéder. Fusionnez d'abord la clé dans `GwenProvides`, puis listez-la dans le `provides` du plugin. Une clé hors de `provides` lève `CORE:PLUGIN_PROVIDE_UNDECLARED`. Les clés de service n'ont pas de règle de nom, sauf le préfixe réservé `renderer:<name>`. Seule une valeur `RendererService` peut utiliser ce préfixe. Rien ne vérifie encore ce préfixe.

```ts
declare module '@gwenjs/schema' {
  interface GwenProvides {
    myService: { getData(): unknown; setData(val: unknown): void }
  }
}

engine.provide('myService', {
  getData() { /* ... */ },
  setData(val) { /* ... */ },
})
```

Un nom de hook personnalisé se type de la même façon, en fusionnant dans `GwenRuntimeHooks`. Les deux interfaces viennent de `@gwenjs/schema`.

Accédez au service dans un système en utilisant `useService()` :

```ts
import { defineSystem, useService, onUpdate } from '@gwenjs/core/system'

export const MySystem = defineSystem(function MySystem() {
  const myService = useService('myService')

  onUpdate(() => {
    const data = myService.getData()
  })
})
```

## Écrire des composables réutilisables

Les plugins exposent souvent des **composables** — des fonctions comme `useSprite()` ou `useHTML()` que le code de jeu appelle à l'intérieur des acteurs (et bientôt des scènes) pour acquérir une ressource et la libérer automatiquement.

### `onCleanup` — le bon primitif de cycle de vie

Lors de l'écriture d'un composable, utilisez `onCleanup` depuis `@gwenjs/core` plutôt que `onDestroy` depuis `@gwenjs/core/actor`.

```ts
// ✅ CORRECT — fonctionne dans les acteurs et tout autre contexte établissant un scope de cleanup
import { onCleanup } from '@gwenjs/core'
import { useService } from '@gwenjs/core/system'

export function useParticles(opts?: { layer?: string }): ParticleHandle {
  const service = useService('renderer:particles')
  const handle = service.allocateHandle(opts?.layer ?? 'game')
  onCleanup(() => handle.destroy())   // s'exécute à la fin du scope englobant
  return handle
}
```

```ts
// ❌ INCORRECT — lève une exception si appelé hors d'une factory defineActor()
import { onDestroy } from '@gwenjs/core/actor'

export function useParticles(): ParticleHandle {
  const service = useService('renderer:particles')
  const handle = service.allocateHandle('game')
  onDestroy(() => handle.destroy())   // erreur : pas de contexte acteur actif
  return handle
}
```

### Comment fonctionne `onCleanup`

`onCleanup` enregistre un callback sur le GwenScope actif quand il y en a un. Dans le `setup()` d'un plugin, ce scope de plugin exécute les callbacks en ordre LIFO lors de `engine.unuse(name)` et de `engine.stop()`. Hors d'un GwenScope, `onCleanup` utilise la pile établie par `withCleanup`.

| Scope | Déclencheur du cleanup |
|---|---|
| Factory `defineActor()` | Acteur despawné |
| Setup `definePlugin()` | Lors de `engine.unuse(name)` ou `engine.stop()` (LIFO) |
| `withCleanup(() => { ... })` | Appel manuel à `dispose()` |

Si aucun contexte de cleanup n'est actif, `onCleanup` est un **no-op silencieux** — sûr à appeler sans condition.

### Pattern composable pour les auteurs de plugins

```ts
import { onCleanup } from '@gwenjs/core'
import { useService } from '@gwenjs/core/system'
import type { MyHandle } from './types.js'

/**
 * Acquiert une ressource depuis MyPlugin et la libère automatiquement
 * à la fin du scope englobant (despawn d'acteur, sortie de scène, etc.).
 *
 * Doit être appelé dans un contexte de cleanup : `defineActor()`, `definePlugin()`,
 * ou tout scope enveloppé dans `withCleanup`.
 */
export function useMyResource(id: string): MyHandle {
  const service = useService('my-plugin')
  const handle = service.acquire(id)
  onCleanup(() => handle.release())
  return handle
}
```

Le code de jeu bénéficie alors d'une gestion automatique du cycle de vie sans cleanup manuel :

```ts
export const PlayerActor = defineActor(PlayerPrefab, () => {
  const particles = useMyResource('trail')   // libéré au despawn automatiquement
  onUpdate((dt) => particles.setPosition(Position.x[id], Position.y[id]))
})
```

### Utiliser `withCleanup` directement

Le `setup()` d'un plugin s'exécute déjà dans un scope de plugin. `onCleanup` y court lors de `engine.unuse(name)` et `engine.stop()`, en ordre LIFO, sans `withCleanup`. Utilisez `withCleanup` seulement hors d'un GwenScope :

```ts
import { withCleanup, onCleanup } from '@gwenjs/core'

const [handle, dispose] = withCleanup(() => {
  const h = service.acquire('my-resource')
  onCleanup(() => h.release())
  return h
})

// Plus tard, quand terminé :
dispose()  // libère la ressource
```

::: tip Support des scènes
Le cycle de vie des scènes (`onEnter` / `onExit`) n'établit pas encore de contexte de cleanup, donc `onCleanup` est un no-op lorsqu'il est appelé depuis `onEnter`. Une future mise à jour de `@gwenjs/core` enveloppera `onEnter` dans `withCleanup` et effectuera le dispose sur `onExit`, rendant tous les composables transparents dans les scènes. **Utilisez `onCleanup` dès maintenant** pour que votre plugin soit compatible sans aucune modification.
:::

### `tryUseEngine()`

`tryUseEngine()` retourne le moteur que `useEngine()` retourne, ou `undefined` là où `useEngine()` lance `CORE:OUTSIDE_ENGINE_CONTEXT`. Il ne lance jamais. Utilisez-le dans un plugin qui doit fonctionner avec ou sans moteur.

```ts
import { tryUseEngine } from '@gwenjs/kit'

export function logIfRunning(message: string): void {
  const engine = tryUseEngine()
  if (engine === undefined) return
  engine.logger.info(message)
}
```

### Tester la surface des composables

`@gwenjs/plugin-conformance` exporte `runComposableSurfaceSuite(entry, { allow })`. Appelez-le en haut d'un fichier de test avec l'entrée principale de votre paquet :

```ts
// tests/composable-surface.test.ts
import { runComposableSurfaceSuite } from '@gwenjs/plugin-conformance'
import * as entry from '../src/index'

runComposableSurfaceSuite(entry, { allow: ['formatScore'] })
```

Il enregistre deux types de lignes dans un describe `composable surface` :

- `every function export matches a prefix rule` échoue sur un export de fonction dont le nom ne correspond pas à `^(define|use|on|place|create|get|with)[A-Z]`. Les classes sont ignorées. Un nom dans `allow` est exempté. Un nom de `allow` qui n'est pas un export de fonction fait échouer la ligne. Un nom qui suit déjà la règle du préfixe est accepté et n'a aucun effet.
- `<name> outside any context throws GwenContextError` est enregistrée pour chaque export de fonction `use*` et `on*`. Elle appelle l'export sans argument et exige une instance de `GwenContextError` de `@gwenjs/kit`. Un export qui retourne, ou qui lance une autre erreur, échoue.

La suite demande `vitest` et `@gwenjs/kit` dans votre projet.

## Gestion des erreurs

`onError` s'exécute quand le `setup()` ou le `teardown()` de ce plugin, ou un handler de hook qu'il a enregistré avant le premier `await` de `setup()`, lève une erreur :

```ts
export const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup(engine) {
    engine.hooks.hook('engine:render', () => { /* ... */ })
  },

  onError(error, context) {
    if (context.hook === 'engine:render') {
      // Ce plugin juge une erreur de rendu sans gravité : pas d'isolation, pas d'événement sur le bus
      context.recover()
      return
    }
    // Non récupérée : le plugin est isolé et l'erreur est publiée sur le bus d'erreurs
    if (error instanceof Error) console.error(`[my-plugin] ${error.message}`)
  },
}))
```

`error` est de type `unknown`. L'objet `context` fournit :
- `phase` — `'setup'`, `'teardown'`, `'onBeforeUpdate'`, `'onUpdate'`, `'onAfterUpdate'`, `'onRender'`, ou `'hook'` pour tout autre hook. `engine:render` correspond à `'onRender'`
- `hook` — Le nom du hook, quand un handler de hook a levé l'erreur
- `frame` — L'index de frame au moment de l'erreur
- `recover()` — Marque l'erreur comme traitée. La cible n'est pas isolée et aucun événement n'est publié sur le bus

`onError` n'est pas appelé pour un trap WebAssembly, donc `recover()` ne peut pas en traiter un. Un handler enregistré après un `await`, ou pour `engine:memory-grow`, n'atteint jamais `onError`. `recover()` ne fait pas non plus résoudre `engine.use()` : un `setup()` qui a levé une erreur est toujours rejeté.

## Chemin d'erreur unique

Une erreur de plugin suit un seul chemin, qu'elle vienne de `setup()`, de `teardown()` ou d'un hook.

- `setup()` lève : le bus reçoit `CORE:PLUGIN_SETUP_ERROR`, puis `engine.use()` rejette avec l'erreur d'origine, sans enveloppe.
- `teardown()` ou un handler de hook lève : le bus reçoit `CORE:PLUGIN_RUNTIME_ERROR`, et le hook `plugin:error` se déclenche.

Écoutez avec `engine.errors.on` (voir [Bus d'erreurs](/fr/advanced/error-bus)) ou le hook `plugin:error`. Aucun des deux ne voit une erreur traitée par `recover()`. `plugin:error` ne se déclenche pas pour une erreur de `setup()`. Un trap WebAssembly publie `CORE:WASM_PANIC` à la place.

## Composables liés au scope

Trois composables lisent le scope que le moteur ouvre autour de `setup()`. Importez-les depuis `@gwenjs/kit`, l'entrée racine, pas depuis `@gwenjs/kit/plugin`.

| Composable | Retourne |
|---|---|
| `useLogger()` | Le logger du moteur, étiqueté `plugin:<name>` dans un plugin |
| `useErrorReporter()` | `{ report(code, message, cause?) }`. `report` lève une `GwenError` et n'écrit aucun log. `code` vaut `NAMESPACE:REASON` |
| `usePerfMark(label)` | Une fonction d'arrêt qui journalise la durée au niveau debug et la retourne en millisecondes |

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { useLogger, useErrorReporter } from '@gwenjs/kit'

export const MyPlugin = definePlugin(() => ({
  name: 'my-plugin',
  setup() {
    const log = useLogger()
    const { report } = useErrorReporter()
    log.info('ready')
    // Plus tard, dans une closure : report('MY_PLUGIN:BAD_CONFIG', 'Missing key')
  },
}))
```

Appelez-les avant le premier `await` de `setup()`. Après un `await`, ou hors d'un scope, ils lèvent `GwenContextError` avec le code `CORE:OUTSIDE_ENGINE_CONTEXT`. Capturez le logger dans une variable et utilisez-le depuis la closure.

## En pratique

### Exemple de plugin audio

Voici un plugin audio réaliste utilisant une bibliothèque comme Howler.js :

```ts
import { definePlugin } from '@gwenjs/kit/plugin'
import { defineGwenModule } from '@gwenjs/kit/module'
import { Howl } from 'howler'

interface AudioOptions {
  volume?: number
}

class AudioManager {
  private sounds = new Map<string, Howl>()

  constructor(private volume: number = 0.8) {}

  load(name: string, src: string) {
    const sound = new Howl({ src, volume: this.volume })
    this.sounds.set(name, sound)
  }

  play(name: string) {
    this.sounds.get(name)?.play()
  }

  stop(name: string) {
    this.sounds.get(name)?.stop()
  }

  setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol))
    this.sounds.forEach((sound) => sound.volume(this.volume))
  }

  dispose() {
    this.sounds.forEach((sound) => sound.unload())
    this.sounds.clear()
  }
}

declare module '@gwenjs/schema' {
  interface GwenProvides {
    audio: AudioManager
  }
}

const audioDefaults: AudioOptions = {}

export const AudioPlugin = definePlugin(
  { provides: ['audio'], options: { defaults: audioDefaults } },
  (opts) => ({
    name: 'audio',
    setup(engine) {
      const manager = new AudioManager(opts.volume)
      engine.provide('audio', manager)

      engine.hooks.hook('engine:stop', () => {
        manager.dispose()
      })
    },
  }),
)

// Module to package the plugin
export default defineGwenModule({
  meta: { name: '@gwenjs/audio', configKey: 'audio' },
  defaults: { volume: 0.8 },
  setup(options, gwen) {
    gwen.addPlugin({ src: "@gwenjs/audio", export: "AudioPlugin", options })
    gwen.addAutoImports([
      { name: 'useAudio', from: '@gwenjs/audio' },
    ])
  },
})
```

Utilisez dans un système :

```ts
import { defineSystem, useService, onUpdate } from '@gwenjs/core/system'

export const SoundEffectSystem = defineSystem(function SoundEffectSystem() {
  const audio = useService('audio')

  audio.load('jump', '/sounds/jump.mp3')
  audio.load('coin', '/sounds/coin.mp3')

  onUpdate(() => {
    // Play sounds based on game events
  })
})
```

## Résumé de l'API

### definePlugin

Fonction factory pour créer un plugin :

```ts
const MyPlugin = definePlugin(declaration, (opts) => ({
  name: string
  requires?: { plugins?: (GwenPluginName | GwenExtensionRequirement)[]; services?: GwenServiceKey[]; optional?: GwenServiceKey[] }
  setup(engine: GwenEngineBase): void | Promise<void>
  teardown?(): void | Promise<void>
  onError?(error: unknown, context: PluginErrorContext): void
}))
```

`declaration` est `{ provides, extensionApi?, options?: { defaults, validate? } }`. Un plugin sans services ni options passe seulement la factory : `definePlugin(() => ({ ... }))`.

### GwenEngineBase

L'API moteur disponible dans `setup()` :

| Méthode | But |
|---------|-----|
| `provide<K extends GwenServiceKey>(key, value)` | Enregistre un service. `value` est `GwenProvides[K]` |
| `inject<K extends GwenServiceKey>(key)` | Renvoie `GwenProvides[K]`. Lance une erreur si la clé est absente |
| `tryInject<K extends GwenServiceKey>(key)` | Renvoie `GwenProvides[K] \| undefined` |
| `hooks.hook(name, callback)` | Enregistre du travail de frame ou un callback de cycle de vie. `engine:init` se déclenche à `engine.start()` une fois tous les plugins installés. `engine:start` se déclenche au début de la boucle |

### PluginErrorContext

```ts
interface PluginErrorContext {
  phase: 'setup' | 'teardown' | 'onBeforeUpdate' | 'onUpdate' | 'onAfterUpdate' | 'onRender' | 'hook'
  hook?: string
  frame: number
  recover(): void
}
```

## Plugins WASM

Les plugins peuvent charger un binaire `.wasm` et interagir avec lui via des vues mémoire typées et des ring buffers. Appelez `engine.loadWasmModule()` dans `setup()` :

```typescript
import { definePlugin } from '@gwenjs/kit/plugin'

export const PhysicsPlugin = definePlugin(() => ({
  name: 'PhysicsPlugin',
  async setup(engine) {
    const handle = await engine.loadWasmModule({
      name: 'my-physics',
      url: new URL('./my-physics.wasm', import.meta.url),
      memory: {
        regions: [
          { name: 'agents', byteOffset: 65536, byteLength: 409600, type: 'f32' },
        ],
      },
      channels: [
        { name: 'commands', direction: 'ts→wasm', capacity: 256, itemByteSize: 16 },
      ],
      step: (handle, dt) => {
        handle.exports.step(dt)
      },
    })

    // Vue de région mémoire — toujours live après memory.grow()
    const agents = handle.region('agents')
    agents.f32[0] = 1.0

    // Ring buffer
    const cmd = handle.channel('commands')
    const data = new Float32Array([1, 0, 0, 0])
    cmd.push(data)  // retourne false si plein
  },
  teardown() {},
}))
```

Donnez le binaire par `url`, `bytes` ou `module`, exactement un des trois. `bytes` et `module` ne font aucun téléchargement, ce qui convient à Node :

```typescript
import { readFile } from 'node:fs/promises'

const handle = await engine.loadWasmModule({ name: 'my-physics', bytes: await readFile('./my-physics.wasm') })
```

`maxBytes` plafonne une source `url` ou `bytes` avant la compilation (`16 MiB` par défaut, `16777216` octets). Une source `module` est déjà compilée et n'est pas vérifiée (`packages/core/src/engine/engine-types.ts:74`).

### WasmModuleOptions

| Champ | Type | Description |
|---|---|---|
| `name` | `string` | Identifiant unique — utilisez avec `useWasmModule('name')` dans les systèmes |
| `url` | `URL \| string` | Chemin vers le binaire `.wasm`. Téléchargé. Exactement un parmi `url`, `bytes`, `module` |
| `bytes` | `BufferSource` | Octets `.wasm` bruts. Compilés dans le processus, sans téléchargement |
| `module` | `WebAssembly.Module` | Module déjà compilé. Ni téléchargement ni compilation |
| `maxBytes` | `number` | Plafond d'octets pour `url`/`bytes` avant la compilation ; 16 MiB par défaut. Non vérifié pour `module` |
| `memory.regions` | `WasmMemoryRegion[]` | Tranches nommées de la mémoire linéaire WASM |
| `channels` | `WasmChannelOptions[]` | Ring buffers pour l'échange de messages TS↔WASM |
| `transformRegion` | `string` | Nom optionnel d'une entrée de `memory.regions` qui reçoit la copie des transforms à chaque image |
| `step` | `(handle, dt) => void` | Callback par image (optionnel). `dt` est en secondes |

### Région de transforms

`transformRegion` nomme une entrée de `memory.regions`. À chaque image, avant `step`, le moteur copie les transforms monde dans le début de cette région. La copie est une seule écriture en bloc. Le module ne fait que la lire. Ce qu'il y écrit est écrasé à l'image suivante et n'atteint jamais la mémoire du cœur.

L'offset est l'export `gwen_<name>_ptr()` quand le module le fournit, sinon le `byteOffset` de la région. Sans `transformRegion`, `transform_buffer_ptr()` vaut `0` et rien n'est copié.

Quand cet export existe, le moteur instancie le module deux fois. La première instance lit l'offset. La seconde est le handle que le jeu garde. La fonction `start` s'exécute sur les deux instances. Le second `start` voit l'offset renvoyé par le premier export. La version d'API du plugin est vérifiée avant d'accepter cet offset. Un offset de sonde différent de la seconde instance est `CORE:WASM_MODULE_REGION_INVALID`.

Importez `gwen.transform_buffer_ptr`, `gwen.transform_stride` (32), `gwen.max_entities` et `gwen.abi_version`. `abi_version` renvoie `2_001_000` et reste constant pendant toute la vie du module. Le format est little-endian, 32 octets par index d'entité :

| Offset | Type | Sens |
|---|---|---|
| 0 | f32 | x monde |
| 4 | f32 | y monde |
| 8 | f32 | rotation monde, radians |
| 12 | f32 | scale x monde |
| 16 | f32 | scale y monde |
| 20 | u32 | bit 0 = le slot a un transform ; les autres bits sont à 0 |
| 24 | 8 octets | réservé, zéros |

Un slot sans transform fait 32 octets à zéro. Les octets au-delà de `maxEntities * 32` ne sont pas écrits.

### WasmRegionView

```typescript
const region = handle.region('agents')
region.f32   // Float32Array
region.u8    // Uint8Array
region.i32   // Int32Array
// Les vues sont toujours liées au ArrayBuffer courant après memory.grow()
```

### WasmRingBuffer

```typescript
const buf = handle.channel('commands')
buf.push(data)   // enqueue — retourne false si plein
buf.pop(dest)    // dequeue dans dest — retourne false si vide
buf.length       // éléments dans le buffer
buf.empty        // true si rien à dépiler
buf.full         // true si push échouerait
```

### ABI du plugin

La version d'ABI courante est `2_001_000` (v2.1.0). Le nombre vaut `major * 1_000_000 + minor * 1_000 + patch`.

`loadWasmModule` rejette un module dont l'export `gwen_plugin_api_version` est absent, n'est pas une fonction, ou n'est pas exactement ce nombre. L'erreur est `GwenWasmAbiError`, code `CORE:WASM_MODULE_ABI_MISMATCH`. Le message nomme le module et les deux versions. Si l'export est absent ou n'est pas une fonction, la version réelle se lit « none declared ». Le module n'est pas enregistré. Le moteur continue.

Un changement ultérieur augmente le nombre de 1_000 dans la même pull request s'il change l'un de ces trois points :

- un nom d'import `gwen`, sa signature, ou le sens de la valeur renvoyée
- la disposition de la région de transforms (taille du slot, offsets des champs, ou bits de flags)
- la disposition du canal ring-buffer, ou la convention d'export `gwen_<name>_ring_ptr` / `gwen_<name>_ptr`

Un changement d'un export du cœur n'augmente pas ce nombre. Le cœur est livré avec sa propre glue JavaScript.

En Rust, `gwen_plugin_abi!()` émet `gwen_plugin_api_version() -> i32` et renvoie `GWEN_PLUGIN_API_VERSION` de `gwen-wasm-utils`. Recompilez le plugin après une augmentation. L'import hôte `gwen.abi_version() -> i32` renvoie le même nombre pendant toute la vie du module.
