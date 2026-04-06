---
title: "@gwenjs/vite"
description: "Référence API pour @gwenjs/vite."
---

# @gwenjs/vite

`pnpm add @gwenjs/vite`

Intégration Vite pour GWEN. Gère le bundling WASM, le hot-reload et l'injection d'assets pour des workflows de développement transparents.

## Plugin principal

### gwen(options)

**Signature:**
```ts
function gwen(options?: GwenVitePluginOptions): VitePlugin
```

**Description.** La fabrique du plugin Vite principal pour les projets GWEN. Gère le bundling WASM, le hot-reload et l'injection de manifeste. C'est le plugin principal que vous enregistrerez dans votre configuration Vite.

**Paramètres:**
| Paramètre | Type | Description |
|---|---|---|
| options | `GwenVitePluginOptions` | Configuration du plugin |
| options.cratePath | `string` | Chemin vers la crate Rust (optionnel) |
| options.watch | `boolean` | Activer le hot-reload WASM (défaut: true en dev) |
| options.wasmDir | `string` | Répertoire de sortie pour les fichiers WASM (défaut: 'dist/wasm') |

**Retourne:** `VitePlugin` — instance du plugin Vite.

**Exemple:**
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { gwen } from '@gwenjs/vite';

export default defineConfig({
  plugins: [
    gwen({
      cratePath: './rust-wasm',
      watch: true,
      wasmDir: 'dist/wasm'
    })
  ]
});
```

## Fonctionnalités

### Bundling WASM

Le plugin automatiquement:
- Détecte et bundle les modules WASM depuis votre projet
- Injecte le code de chargement WASM dans le build
- Gère les extensions de fichier et la résolution de chemin

### Hot-Reload WASM

Quand `watch: true` (défaut en mode dev):
- Les fichiers WASM sont rechargés sans rafraîchissement de page complet
- L'itération de développement est rapide et fluide
- Seuls les modules WASM affectés sont reconstruits

**Exemple:**
```ts
gwen({
  watch: true // Activer pendant le développement
})
```

### Injection de manifeste

Le plugin injecte le manifeste WASM via la variable globale `__GWEN_MANIFEST__`:
- Disponible à l'exécution pour accéder aux chemins des modules WASM
- Généré automatiquement lors du build
- Contient toutes les métadonnées WASM bundlées

**Utilisation dans le code:**
```ts
// À l'exécution, __GWEN_MANIFEST__ contient:
// { wasmModules: { 'physics2d': '...' }, ... }
const manifest = globalThis.__GWEN_MANIFEST__;
```

## Plugins de physique

Le paquet vite réexporte les plugins de physique pour la commodité:

### physics2dVitePlugin()

**Signature:**
```ts
function physics2dVitePlugin(): VitePlugin
```

**Description.** Plugin Vite pour la physique 2D (Rapier2D). Enregistré automatiquement quand Physics2DPlugin est utilisé.

**Exemple:**
```ts
import { physics2dVitePlugin } from '@gwenjs/vite';

// Généralement pas nécessaire—Physics2DPlugin gère cela automatiquement
plugins: [physics2dVitePlugin()]
```

### physics3dVitePlugin()

**Signature:**
```ts
function physics3dVitePlugin(): VitePlugin
```

**Description.** Plugin Vite pour la physique 3D (Rapier3D). Enregistré automatiquement quand Physics3DPlugin est utilisé.

## Définitions de type

### GwenVitePluginOptions

```ts
interface GwenVitePluginOptions {
  cratePath?: string;
  watch?: boolean;
  wasmDir?: string;
}
```

**Propriétés:**

| Propriété | Type | Description |
|---|---|---|
| `cratePath` | `string` | Chemin vers la crate Rust contenant la source WASM (optionnel) |
| `watch` | `boolean` | Activer le hot-reload WASM en mode dev (défaut: true) |
| `wasmDir` | `string` | Répertoire de sortie pour les fichiers WASM compilés (défaut: 'dist/wasm') |

**Exemple:**
```ts
const options: GwenVitePluginOptions = {
  cratePath: './crates/wasm',
  watch: true,
  wasmDir: 'public/wasm'
};
```

## Exemple d'intégration

Configuration Vite complète avec GWEN:

```ts
// vite.config.ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { gwen } from '@gwenjs/vite';

export default defineConfig({
  plugins: [
    react(),
    gwen({
      cratePath: './wasm',
      watch: true,
      wasmDir: 'dist/wasm'
    })
  ],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true
  }
});
```

## Workflow de développement

1. **Démarrer le serveur de dev:**
   ```bash
   vite
   ```

2. **Les changements WASM sont hot-reloadés** automatiquement quand `watch: true`

3. **Builder pour la production:**
   ```bash
   vite build
   ```

Le plugin gère tout la compilation et l'injection WASM de manière transparente.
