# Contributing Guide

## Prerequisites

- **Node.js** ≥ 20
- **pnpm** ≥ 9
- **Rust** + `wasm-pack` (only needed for crate changes)
  - Install: `rustup target add wasm32-unknown-unknown`

## Initial Setup

```bash
# Clone repository
git clone https://github.com/gwenjs/gwen
cd gwen

# Install all dependencies (TypeScript + Rust targets)
pnpm install
rustup target add wasm32-unknown-unknown

# For full setup with WASM builds:
pnpm install:all
```

## Build & Test Commands

### TypeScript Packages

```bash
# Build all TS packages
pnpm build:ts

# Test all packages
pnpm test:ts

# Test single package
pnpm --filter @gwenjs/core test

# Build single package
pnpm --filter @gwenjs/core build

# Lint with oxlint
pnpm lint

# Fix linting issues
pnpm lint:fix

# Type checking
pnpm typecheck
```

### WASM (Rust Crates)

```bash
# Build all WASM variants (debug by default)
pnpm build:wasm

# Build with optimizations
pnpm build:cargo

# Build debug variant
pnpm build:cargo:debug

# Watch and rebuild on file changes
pnpm dev

# Run Rust tests
pnpm test:cargo

# Full test suite (Rust + TypeScript)
pnpm test
```

### Documentation

```bash
# Start dev server (live reload)
pnpm docs:dev

# Build static docs
pnpm docs:build

# Preview built docs
pnpm docs:preview
```

## Workflow

### Working on TypeScript Packages

```bash
# Install dependencies
pnpm install

# Make changes
# ...

# Build & test your changes
pnpm build:ts
pnpm test:ts

# Run linter
pnpm lint
pnpm typecheck

# Commit (see conventions below)
git commit -m "feat(core): add feature description"
```

### Working on Rust Crates

```bash
# Build WASM
pnpm build:wasm

# Make changes to crates/
# ...

# Test Rust code
pnpm test:cargo

# Build TypeScript packages (imports WASM)
pnpm build:ts

# Run full test suite
pnpm test

# Commit
git commit -m "feat(gwen-core): add feature description"
```

### Package-Specific Workflows

```bash
# Test only @gwenjs/core while developing
pnpm --filter @gwenjs/core test --watch

# Build only physics2d and run its tests
pnpm --filter @gwenjs/physics2d build
pnpm --filter @gwenjs/physics2d test

# Watch and rebuild core (useful during development)
pnpm --filter @gwenjs/core exec tsc --watch --noEmit
```

## Commit Conventions

Commits follow **Conventional Commits** (enforced by commitlint + husky):

```
type(scope): message

optional body

optional footer
```

**Types:** `feat`, `fix`, `docs`, `chore`, `test`, `refactor`, `perf`

**Scopes:** Package name or area
- `core` — @gwenjs/core
- `app` — @gwenjs/app
- `physics2d` — @gwenjs/physics2d
- `physics3d` — @gwenjs/physics3d
- `vite` — @gwenjs/vite
- `schema` — @gwenjs/schema
- `math` — @gwenjs/math
- `kit` — @gwenjs/kit
- `docs` — documentation
- `ci` — CI/build scripts
- `gwen-core` — Rust crate

**Examples:**

```bash
git commit -m "feat(core): add spatial query system"
git commit -m "fix(physics2d): correct collision callback timing"
git commit -m "docs(contributing): add WASM build instructions"
git commit -m "perf(core): optimize SoA iteration"
git commit -m "test(physics3d): add fracture test cases"
```

## Release Process

Releases are **fully automated** via Release Please:

1. **Merge PR to `main`** — CI validates all tests pass
2. **Release Please** automatically:
   - Analyzes conventional commits since last release
   - Bumps versions (semantic versioning)
   - Updates CHANGELOG.md
   - Creates release tag
   - Publishes npm packages
3. **GitHub Release** created automatically

See `release-please-config.json` for release configuration per package.

### Version Strategy

- **feat:** minor bump (0.1.0 → 0.2.0)
- **fix:** patch bump (0.1.0 → 0.1.1)
- **BREAKING CHANGE:** major bump (0.1.0 → 1.0.0)

## Adding a New Package

1. **Create directory structure:**
   ```bash
   mkdir -p packages/my-package/src
   ```

2. **Create `package.json`:**
   ```json
   {
     "name": "@gwenjs/my-package",
     "version": "0.1.0",
     "type": "module",
     "exports": {
       ".": "./dist/index.js"
     },
     "main": "./dist/index.js",
     "types": "./dist/index.d.ts",
     "scripts": {
       "build": "tsc",
       "test": "vitest"
     },
     "devDependencies": {
       "typescript": "workspace:*",
       "vitest": "workspace:*"
     }
   }
   ```

3. **Create `tsconfig.json`:**
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "include": ["src"],
     "compilerOptions": {
       "outDir": "dist",
       "rootDir": "src"
     }
   }
   ```

4. **Create `src/index.ts`:**
   ```typescript
   export const myFunction = () => {
     // ...
   };
   ```

5. **Update workspace:**
   - Ensure `pnpm-workspace.yaml` includes `packages/*` (already does)
   - Add package reference to root `tsconfig.json` if cross-package dependencies exist

6. **Update CI** (if separate test suite needed):
   - Add to `.github/workflows/ci.yml` test matrix

## WASM Development

### Build Variants

Three variants exist (controlled by Cargo features):

- **light** — No physics (ECS + transforms only)
- **physics2d** — Includes Rapier 2D (default)
- **physics3d** — Includes Rapier 3D + fracture simulation

### WASM Output

- Built binaries are **gitignored** (see `.gitignore`)
- Output location: `packages/{core,physics2d,physics3d}/wasm/`
- CI builds and caches WASM artifacts
- Local development requires `pnpm build:wasm`

### Publishing

- CI builds all variants during publish workflow
- WASM binaries are included in npm packages
- `.wasm` files are not checked into git but are in npm tarballs

### Feature Flags

```bash
# Build physics3d with fracture (requires build-tools)
pnpm build:wasm-tools

# Build standard physics3d only
pnpm build:wasm
```

## Debugging

### TypeScript

```bash
# Debug with Node inspector
node --inspect-brk ./node_modules/vitest/vitest.mjs

# Or use VSCode debugger with:
# - "type": "node"
# - "runtimeExecutable": "node"
# - "args": ["--inspect-brk", ...]
```

### Rust

```bash
# Build debug variant
pnpm build:cargo:debug

# Run Rust tests with output
cargo test -- --nocapture

# Check memory layout
node scripts/verify-memory-layout.mjs
```

## Documentation

- **User docs**: `/docs` — Built with VitePress, published to gwen.dev
- **Internal docs**: `/internals-docs` — This directory
- **Code comments**: Minimal; code should be self-documenting
- **Type definitions**: Use JSDoc for complex types

## Code Style

- Use TypeScript strict mode
- Prefer const over let over var
- Use meaningful variable names
- Keep functions small and focused
- Add tests for public APIs
- No console.log in production code (use appropriate logger)

## Testing

```bash
# Run all tests
pnpm test

# Run tests for one package
pnpm --filter @gwenjs/core test

# Run with coverage
pnpm --filter @gwenjs/core test -- --coverage

# Watch mode
pnpm --filter @gwenjs/core test -- --watch
```

Test files use Vitest. Prefer:
- Descriptive test names
- Clear arrange/act/assert
- Minimal mocking
- Integration tests over unit tests where possible

## Questions?

- Check existing documentation in `/docs`
- Look at RFCs in source code comments
- Ask in GitHub discussions or open an issue
