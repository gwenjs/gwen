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

## Intégration Vite

Le plugin Vite de GWEN est géré automatiquement via `gwen.config.ts`. Si vous devez personnaliser la configuration Vite (par exemple, ajouter un plugin de rendu), le paquet `@gwenjs/vite` exporte un plugin `gwen()` que vous pouvez inclure manuellement :

**vite.config.ts** *(uniquement pour les configurations personnalisées)*
```typescript
import { defineConfig } from 'vite'
import { gwen } from '@gwenjs/vite'

export default defineConfig({
  plugins: [
    gwen({ cratePath: '../crates/gwen-core' }),
  ],
})
```

::: tip
Pour la plupart des projets, vous n'avez pas besoin d'un `vite.config.ts` — le framework le gère via `gwen.config.ts`.
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
