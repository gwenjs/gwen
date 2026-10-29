---
title: "@gwenjs/app"
description: "Référence API pour @gwenjs/app."
---

# @gwenjs/app

`pnpm add @gwenjs/app`

Configuration d'app haut niveau et système de modules pour les projets GWEN. S'intègre avec le système de build et l'écosystème des plugins.

## Configuration

### defineConfig(input)

**Signature:**
```ts
function defineConfig(input: GwenUserConfig): GwenUserConfig
```

**Description.** Définit la configuration GWEN de haut niveau. Utilisé dans votre fichier de configuration d'app (typiquement `gwen.config.ts`).

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| input | `GwenUserConfig` | Objet de configuration |

**Retourne:** `GwenUserConfig` — configuration validée.

**Exemple:**
```ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  engine: {
    maxEntities: 10_000,
    variant: 'physics2d',
  },
})
```

## Options de configuration

### GwenUserConfig

**Propriétés:**

| Propriété | Type | Défaut | Description |
|---|---|---|---|
| `mainScene` | `string` | premier fichier de scène | Nom de la scène initiale (doit correspondre au premier argument d'un appel `defineScene()`). Par défaut le framework choisit le premier fichier de scène alphabétiquement — définissez explicitement quand votre scène initiale n'est pas la première. |
| `modules` | `string[]` | `[]` | Modules à activer. Chaque entrée est le nom du paquet npm. Les options du module sont déclarées comme clé top-level (ex. `physics2d: { gravity: -9.81 }`). |
| `engine.maxEntities` | `number` | `10_000` | Nombre maximum d'entités simultanées. |
| `engine.targetFPS` | `number` | `60` | Fréquence d'images cible. |
| `engine.variant` | `'light' \| 'physics2d' \| 'physics3d'` | auto | Variante WASM à charger. Détectée automatiquement depuis `modules` si omise. |
| `engine.loop` | `'internal' \| 'external'` | `'internal'` | Qui gère la boucle de jeu (`requestAnimationFrame`). |
| `engine.maxDeltaSeconds` | `number` | `0.1` | Clamp maximum du delta time par frame (secondes). |
| `engine.physicsHz` | `number` | `0` | Fréquence de simulation fixe en Hz. Si non nul, chaque frame d'affichage exécute au plus `maxCatchupSteps` pas et un `engine:render(alpha)`. `advance(dt)` partage l'accumulateur. |
| `engine.maxCatchupSteps` | `number` | `2` | Nombre maximum de pas fixes par frame d'affichage. Les pas entiers au-delà du plafond sont abandonnés. |
| `engine.debug` | `boolean` | `false` | Quand `logger.minLevel` est omis, `true` abaisse le niveau minimum du logger du moteur à `debug` (logs d'initialisation des plugins inclus). Un `logger.minLevel` fixé l'emporte. Les vérifications sentinelles par frame, le timing de phase et l'avertissement d'isolation ne tournent que si `__GWEN_DEV__` est aussi vrai (`true` avec `vite` et `vite build --mode development`, `false` avec `vite build`). |
| `logger.providers` | `IGwenLogProvider[]` | fournisseur console | Fournisseurs du logger du moteur. Passés à `createEngine`. `[]` ne livre rien. |
| `logger.minLevel` | `'debug' \| 'info' \| 'warn' \| 'error'` | `debug` quand `engine.debug` est vrai et que ceci est omis, sinon `warn` | Niveau minimum livré aux fournisseurs. Quand il est fixé, il l'emporte sur `engine.debug`. |
| `globalCss` | `string[]` | `[]` | Fichiers CSS injectés dans chaque page, relatifs à la racine du projet (ex. `'./src/styles/global.css'`). |
| `viewports` | `Record<string, ViewportRegion>` | — | Déclarations statiques de viewports (régions normalisées 0–1). Si absent, un viewport `'main'` plein écran est créé automatiquement. |
| `screen.sizeProvider` | `ScreenSizeProvider` | auto | Fournisseur de taille personnalisé pour `ScreenPlugin`. Détecté automatiquement en navigateur (ResizeObserver). Requis pour Node.js ou les environnements sans DOM. |
| `hooks` | `Partial<GwenBuildHooks>` | — | Abonnements aux hooks de build. |
| `plugins` | `GwenPlugin[]` | — | Plugins runtime à enregistrer directement, sans module wrapper. |

**Exemple:**
```ts
export default defineConfig({
  modules: ['@gwenjs/physics2d'],
  physics2d: { gravity: -9.81 },
  engine: {
    maxEntities: 5_000,
    targetFPS: 60,
    variant: 'physics2d',
    debug: true,
  },
  globalCss: ['./src/styles/reset.css'],
  viewports: {
    main: { x: 0, y: 0, width: 1, height: 1 },
  },
  // Node.js uniquement — le navigateur détecte la taille automatiquement via ResizeObserver
  // screen: { sizeProvider: StaticSizeProvider({ width: 1920, height: 1080 }) },
})
```

### ResolvedGwenConfig

**Signature:**
```ts
type ResolvedGwenConfig = GwenUserConfig & {
  engine: GwenEngineConfig
  modules: string[]
  logger: GwenLoggerConfig & { minLevel: GwenLogLevel }
}
```

**Description.** Configuration entièrement résolue, avec les défauts du moteur remplis. `engine.variant` est la valeur explicite, ou la variante dérivée de `modules`. Un module la lit sur `kit.options`, un objet gelé en profondeur pour tout l'appel `setupModules`, sauf `plugins` (les éléments), `vite` et `hooks`, qui gardent leur identité, et les fonctions et les instances de classe ne sont jamais copiées.

`resolveGwenConfig` charge `gwen.config.ts`. Les objets simples fusionnent en profondeur. Un tableau de la couche haute remplace le tableau de la couche basse. `undefined` laisse la valeur basse. `null` est une valeur. Une fonction ou une instance de classe est gardée par référence. Une clé propre `__proto__` ne change pas le prototype.

Le chargement a deux phases. `resolveGwenConfig` rejette un champ de `engine`, un `engine` ou un `logger` qui n'est pas un objet, une entrée de module en tuple, et un `engine.variant` explicite qui contredit un module de physique (`APP:CONFIG_CONFLICT`). `GwenApp.setupModules` rejette une clé top-level inconnue, un `configKey` réservé ou dupliqué (`APP:CONFIG_CONFLICT`), un problème de `validate`, une section de module qui n'est pas un objet, et une valeur qui n'est pas sérialisable en JSON, y compris un cycle ou `undefined` dans un tableau. Chaque phase lève sa propre `GwenAppConfigError`. Une config avec un problème de moteur et une clé inconnue lève deux fois. Une entrée de module est le nom du paquet, une chaîne. Un module listé plus d'une fois, ou un module intégré aussi listé dans `modules`, s'exécute une fois. Une section de module doit être un objet ; `false`, `null`, les tableaux et les primitives sont rejetés. Il n'y a pas de bloc `debug` top-level. `engine.loop` vaut `"internal"` ou `"external"`.

c12 ne lit pas `.env`, les fichiers rc, `package.json`, ni les couches `$development` / `$test`. `NODE_ENV` n'en sélectionne pas.

### GwenBuildHooks

**Signature:**
```ts
interface GwenBuildHooks {
  'build:before': () => void
  'build:done':   () => void
  'module:before': (mod: { meta: { name: string } }) => void
  'module:done':   (mod: { meta: { name: string } }) => void
  'vite:extendConfig': (config: ViteUserConfig) => void
}
```

**Description.** Hooks de build disponibles dans `gwen.config.ts` via le champ `hooks`, ou dans un module via `gwen.hook()`.

| Événement | Se déclenche quand |
|---|---|
| `build:before` | Avant qu'un `setup()` de module ne s'exécute |
| `build:done` | Après que tous les modules ont été configurés |
| `module:before` | Avant le `setup()` de chaque module individuel |
| `module:done` | Après le `setup()` de chaque module individuel |
| `vite:extendConfig` | Quand un module appelle `gwen.extendViteConfig()` |

**Exemple:**
```ts
export default defineConfig({
  hooks: {
    'build:done': () => {
      console.log('Tous les modules chargés')
    },
  },
})
```
