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
| `engine.physicsHz` | `number` | `0` | Fréquence de simulation fixe en Hz. Si non nul, `start()` utilise une boucle à pas fixe avec accumulateur. |
| `engine.maxCatchupSteps` | `number` | `2` | Nombre maximum de pas fixes par frame réelle (protection contre la spirale de rattrapage). |
| `engine.debug` | `boolean` | `false` | Active les logs verbeux, les vérifications sentinelles par frame, les avertissements de timing de phase et les logs d'initialisation des plugins. |
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
  engine: Required<NonNullable<GwenUserConfig['engine']>>
  modules: GwenModuleEntry[]
}
```

**Description.** Configuration entièrement résolue avec tous les defaults appliqués. Utilisée en interne et transmise aux fonctions `setup()` des modules.

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
