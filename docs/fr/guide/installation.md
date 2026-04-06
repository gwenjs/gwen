---
title: Installation
description: Comment installer les packages GWEN dans un projet existant.
---

# Installation

Si vous avez déjà un projet TypeScript + Vite et que vous voulez ajouter GWEN, suivez ce guide.

## Prérequis

- Node.js 18+, pnpm 8+
- Un projet TypeScript existant (ou démarrez à nouveau avec `npm create vite@latest my-app -- --template react-ts`)

::: tip Aucun Rust requis
WASM est livré précompilé dans les packages npm. Vous n'aurez jamais besoin d'outils Rust.
:::

## Installer les packages principaux

```sh
pnpm add @gwenjs/core @gwenjs/app @gwenjs/kit
```

- **`@gwenjs/core`** — Moteur ECS, composants, systèmes, scènes
- **`@gwenjs/app`** — Initialisation et configuration du moteur
- **`@gwenjs/kit`** — Système de plugins et modules pour étendre GWEN

## Optionnel : Physique

Si votre jeu a besoin de physique, installez les modules de physique :

```sh
# Physique des corps rigides 2D (Rapier)
pnpm add @gwenjs/physics2d

# Physique des corps rigides 3D (Rapier)
pnpm add @gwenjs/physics3d
```

## Ajouter le plugin Vite

GWEN fournit des plugins Vite pour le bundling automatique de WASM et les intégrations TypeScript.

**vite.config.ts**
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { gwenVite } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    react(),
    gwenVite({
      modules: ['position', 'velocity'], // Auto-importer les modules WASM
    }),
  ],
})
```

::: info Options du plugin
- `modules` — Liste des modules WASM à précharger
- `bundleWasm` — Intégrer WASM ou charger en tant que fichier séparé (par défaut : true)
- `sourceMap` — Activer les cartes sources en WASM (par défaut : false en production)
:::

## Configuration TypeScript

Assurez-vous que votre **tsconfig.json** est configuré pour GWEN :

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ES2020",
    "moduleResolution": "bundler",
    "strict": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "allowSyntheticDefaultImports": true,
    "noEmit": true
  }
}
```

Paramètres clés :
- **`strict: true`** — Détectez les erreurs de type tôt (recommandé)
- **`moduleResolution: bundler`** — Résolution des modules de Vite

## Vérifier l'installation

Exécutez la vérification des types pour vous assurer que tout est bien connecté :

```sh
pnpm typecheck
```

Ou dans votre boucle de développement :

```sh
pnpm dev
```

## Étapes suivantes

- **[Démarrage rapide](/fr/guide/quick-start)** — Créez votre premier jeu en quelques minutes.
- **[Structure du projet](/fr/guide/project-structure)** — Organisez votre code de jeu.
- **[Le moteur](/fr/essentials/engine)** — Initialisez et configurez le moteur GWEN.
