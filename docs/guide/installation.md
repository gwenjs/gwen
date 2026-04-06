---
title: Installation
description: How to install GWEN packages in an existing project.
---

# Installation

If you already have a TypeScript + Vite project and want to add GWEN, follow this guide.

## Prerequisites

- Node.js 18+, pnpm 8+
- An existing TypeScript project (or start fresh with `npm create vite@latest my-app -- --template react-ts`)

::: tip No Rust required
WASM ships pre-compiled in npm packages. You'll never need Rust tools.
:::

## Install Core Packages

```sh
pnpm add @gwenjs/core @gwenjs/app @gwenjs/kit
```

- **`@gwenjs/core`** — ECS engine, components, systems, scenes
- **`@gwenjs/app`** — Engine initialization and configuration
- **`@gwenjs/kit`** — Plugin and module system for extending GWEN

## Optional: Physics

If your game needs physics, install the physics modules:

```sh
# 2D rigid-body physics (Rapier)
pnpm add @gwenjs/physics2d

# 3D rigid-body physics (Rapier)
pnpm add @gwenjs/physics3d
```

## Vite Integration

GWEN's Vite plugin is managed automatically via `gwen.config.ts`. If you need to customize the Vite setup (e.g. add a renderer plugin), the `@gwenjs/vite` package exports a `gwen()` plugin you can include manually:

**vite.config.ts** *(only needed for custom setups)*
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
For most projects you don't need a `vite.config.ts` — the framework handles it through `gwen.config.ts`.
:::

## TypeScript Configuration

Ensure your **tsconfig.json** is set up for GWEN:

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

Key settings:
- **`strict: true`** — Catch type errors early (recommended)
- **`moduleResolution: bundler`** — Vite's module resolution

## Verify Installation

Run type checking to ensure everything is wired correctly:

```sh
pnpm typecheck
```

Or in your dev loop:

```sh
pnpm dev
```

## Next Steps

- **[Quick Start](/guide/quick-start)** — Create your first game in minutes.
- **[Project Structure](/guide/project-structure)** — Organize your game code.
- **[The Engine](/essentials/engine)** — Initialize and configure the GWEN engine.
