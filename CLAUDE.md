# CLAUDE.md

GWEN is a TypeScript-first **web game framework** (Nuxt-like) built on a Rust/WASM ECS core.
The framework hides infrastructure complexity behind a composable API, generates boilerplate
at build time, and ships pre-compiled WASM — users never touch Rust.

> Full API reference → `docs/essentials/` · `docs/api/` · `docs/advanced/` · `docs/kit/`

---

## Absolute rules

1. `pnpm format` — fix and retry if it fails
2. `pnpm lint` — fix and retry if it fails
3. `pnpm typecheck` — fix and retry if it fails
4. `pnpm test` — fix and retry if it fails

Never declare a task done before all 4 pass.

5. Never commit `docs/superpowers/` — specs and plans are local-only (gitignored).

6. A boundary defect fix is accepted only with a real-WASM test that fails without the fix. Boundary means a `#[wasm_bindgen]` export, a `WasmBridgeImpl` method, a view over linear memory, or a plugin↔core WASM call. The test lives under `packages/core/tests/integration-wasm/`.

---

## Repository structure

```
packages/           @gwenjs/* TypeScript packages
  core/             ECS engine: components, systems, actors, scenes, router
  app/              defineConfig() + engine bootstrap
  kit/              Plugin and module authoring (definePlugin, defineGwenModule)
  schema/           Shared types (internal / plugin authors)
  math/             Vec2, Vec3, Quat, Color, Spring — pure, allocation-free
  physics2d/        Rapier 2D WASM wrapper + actor composables
  physics3d/        Rapier 3D WASM wrapper + actor composables
  vite/             Vite plugin — WASM, transforms, auto-imports, virtual modules
crates/             Rust source
  gwen-core/        ECS engine in Rust
  gwen-wasm-utils/  WASM build utilities
docs/               VitePress — full API reference
```

## Dev commands

```sh
pnpm dev                  # watch mode (TS + Rust)
pnpm test:ts              # TS tests only
pnpm test:wasm            # real WASM integration tests
pnpm test:cargo           # Rust tests only
pnpm lint:fix             # auto-fix lint
pnpm build:wasm           # rebuild WASM

# Single test file
pnpm --filter @gwenjs/core exec vitest run src/path/to/file.test.ts
```

---

## Architecture

```
Game code (TypeScript)
  └─ @gwenjs/core    Components, Systems, Actors, Scenes, Router
  └─ @gwenjs/kit     Plugin + Module authoring
  └─ @gwenjs/app     defineConfig() — build-time framework config
  └─ @gwenjs/vite    Vite plugin: WASM, code transforms, virtual modules
       ↕ WASM bridge (JS TypedArray ↔ Rust SharedArrayBuffer)
gwen_core.wasm       SoA linear memory, ECS kernel, Rapier physics
```

---

## Design philosophy

### Framework pattern (Nuxt-like)

GWEN manages `index.html`, `main.ts`, and the Vite config. Users only write `gwen.config.ts`
at the root. The framework reads it at build time to:
- Register modules and plugins
- Configure the WASM variant (`light | physics2d | physics3d`)
- Generate type augmentations and virtual modules
- Extend the Vite config

**No `vite.config.ts`, no `main.ts`** — these are framework responsibilities. Extend Vite via
the `vite` or `hooks` fields in `gwen.config.ts`.

### Composable context system

Every GWEN API is a **composable** — a function that works only when an engine context is
active. The context is active inside:
- `defineSystem(() => { ... })` — system factory
- `defineActor(prefab, () => { ... })` — actor factory
- `defineScene(name, () => { ... })` — scene factory
- `definePlugin({ setup(engine) { ... } })` — plugin setup
- `engine.run(() => { ... })` — explicit context block

Outside these boundaries, composables throw `GwenContextError`. The Vite plugin propagates
context across `await` boundaries automatically for `onEnter`/`onExit`. For other async
contexts, the **capture pattern** is required:

```ts
// ✅ Capture handle synchronously in factory, use as closure after await
const transform = useTransform()
onStart(async () => {
  await loadAssets()
  transform.setPosition(400, 300)  // closure — context not needed
})
```

### ECS — Structure of Arrays (SoA)

Decision: archetype tables with one typed array per field inside each chunk (model C).
Status: to be implemented by #113/#65. Record: [ADR-0001](internals-docs/adr/0001-component-storage.md).

A chunk is one archetype. Every component in that chunk shares the row index. Row order is
not stable, so a field is never indexed by entity id. The only system form is:

```ts
const query = useQuery([Position, Velocity])
onUpdate((dt) => {
  for (const chunk of query) {
    const pos = chunk.get(Position)
    const vel = chunk.get(Velocity)
    for (let i = 0; i < chunk.count; i++) pos.x[i] += vel.vx[i] * dt
  }
})
```

`Position.x[entityId]` and `chunk.x[i]` are not APIs. `ComponentDefinition` has no field arrays.
Identity comes from `chunk.entityId(row)`.

Today the TypeScript registry is still a `Map` per component type, and the Rust columns are
still packed rows. #113/#65 replace that. Until they land, do not write the chunk loop against
this tree and expect it to run.

Adding or removing a component will be an archetype migration: each kept column is moved once
(#113). Do that for state changes, not inside `onUpdate`.

Systems query matching entities (`useQuery`). Actors own one entity. A prefab is a component
template; an actor wraps a prefab with lifecycle hooks and a public API. Entity IDs are `bigint`.

### Build-time transforms (@gwenjs/vite)

The Vite plugin performs source-level transforms that would be impossible at runtime:
- Injects readable system/actor names from exported variable names (devtools, debugging)
- Auto-discovers `src/actors/` and `src/scenes/` and wires them into virtual modules
- Propagates engine context across `await` in `onEnter` / `onExit` callbacks
- Bundles and serves the WASM binary

Virtual modules (`virtual:gwen/actors`, `virtual:gwen/scenes`, …) are consumed internally
by the framework bootstrap — users rarely import them directly.

---

## Key patterns

### Actor vs System

| | Actor | System |
|---|---|---|
| Entity ownership | One entity per instance | Queries many entities |
| Lifecycle | `onStart` / `onUpdate` / `onDestroy` per instance | `onUpdate` shared across all matching entities |
| Use case | Named game objects (player, boss, HUD) | Bulk logic (movement, physics, AI sweep) |
| State | Local to instance | Global / shared |

Use actors for **unique, named objects**. Use systems for **batch operations**.

### Lifecycle phases (execution order per frame)

`onBeforeUpdate` → `onUpdate` → `onAfterUpdate` → `onRender`

All four phases are valid in both systems and actors. `onStart` / `onDestroy` are
actor-only and never exist on systems. `onEvent` does not exist.

### Dependency injection in systems

Systems receive external dependencies as factory arguments, keeping them decoupled:

```ts
// System accepts any object that satisfies the interface
export const CombatSystem = defineSystem((target: { takeDamage(n: number): void }) => { ... })

// Scene wires the concrete actor at setup time
useSystem(CombatSystem(player))
```

### Event system (`useHook`)

| | `useHook(event, fn)` |
|---|---|
| Valid in | any context (system, actor, plugin) |
| Auto-cleanup | when context ends |
| Pool dormancy | warns in dev if actor is dormant |
| Import | `@gwenjs/core` |

`onEvent` does not exist. Use `useHook()`.

Custom hooks must be declared with `defineHooks()` and merged into `GwenRuntimeHooks` via
declaration merging (`InferHooks<T>`) for full type safety project-wide.
Hook names must follow `'namespace:action'` convention — `engine:*` and `entity:*` are
reserved for internal hooks.

### Plugin → service → consumer chain

A plugin registers a service with `engine.provide('name', impl)` in its `setup()`.
Any system or actor can retrieve it with `useService('name')` from `@gwenjs/core/system`.
This is the canonical way to share runtime state between unrelated parts of the game.

### Actor pool (high-frequency actors)

For bullets, particles, and other high-frequency spawns, `defineActorPool` keeps a fixed set
of entities alive and marks them dormant instead of destroying them. Reuse still allocates (alloc gate `pool.cycle`, #56).
The pool handle is obtained via `useActorPool()` inside a scene and passed explicitly to the
systems that need it. Never call `.acquire()` on the `defineActorPool` value directly.

### Module system (framework extensions)

`defineGwenModule` is the build-time equivalent of `definePlugin`. Modules run in Node.js
(not the browser) and extend the framework itself: adding plugins, generating type templates,
registering auto-imports, and extending the Vite config. They are declared by package name in
`gwen.config.ts → modules`.

---

## File conventions

```
gwen.config.ts         Required — framework entry point
src/
  components/          One component per file; re-export from index.ts
  systems/             One system per file; name the export (Vite injects it as display name)
  scenes/              Auto-discovered: each file exports a defineScene()
  actors/              Auto-discovered: each file exports a defineActor()
  prefabs/             Entity templates used by actors and systems
  router.ts            Single defineSceneRouter() for the app
  plugins/             Optional custom plugins
  hooks.ts             Custom hook contracts + GwenRuntimeHooks augmentation
```

---

## Subpath imports

| What | From |
|---|---|
| `createEngine` `useEngine` `defineComponent` `Types` `createLogger` `setupGwen` `useHook` `onCleanup` `emit` `defineHooks` | `@gwenjs/core` |
| `defineSystem` `onUpdate` `onBeforeUpdate` `onAfterUpdate` `onRender` `useQuery` `useService` `useWasmModule` `useComponentFor` | `@gwenjs/core/system` |
| `defineActor` `onStart` `onDestroy` `definePrefab` `useActor` `useComponent` `useEntityId` `usePrefab` `useTransform` `defineLayout` `useLayout` `placeActor` `placeGroup` `placePrefab` `defineActorPool` `useActorPool` | `@gwenjs/core/actor` |
| `defineScene` `defineSceneRouter` `useSceneRouter` `useSystem` `onEnter` `onExit` | `@gwenjs/core/scene` |
| `definePlugin` | `@gwenjs/kit/plugin` |
| `defineGwenModule` | `@gwenjs/kit/module` |
| `defineConfig` | `@gwenjs/app` |
| `useDynamicBody` `useStaticBody` `useKinematicBody` `useBoxCollider` `useShape` … | `@gwenjs/physics2d` |
| `usePhysics3D` … | `@gwenjs/physics3d` |

---

## PR contract

One PR per ticket, against `v1-alpha`. The ticket's `## Technical spec` is the contract: names, codes and paths in it are exact. These rules are checked by CI (`agent-hygiene`) and by review.

1. A test must fail without the fix. Run the new tests against the base source before pushing. A test that passes with the fix deleted proves nothing.
2. The PR body has a table "Acceptance line -> test file::test name" for every Acceptance line, and a "Breaking changes" section (`None.` if none). A line with no test keeps the PR a draft. Never write "MISSING" or "not done" in a ready PR.
3. No new double cast (`as unknown` followed by `as`), no explicit any type, no @-prefixed ts-ignore or ts-expect-error directive, no comment that disables the linter, and no unwrap, expect, panic!, or assert! on an added Rust line. No vitest mock() or fn() helper. Under any `tests/integration-wasm` path, also no spyOn. Exceptions live in `scripts/agent-hygiene/allowlist.json` and need maintainer approval.
4. A breaking change (removed or renamed export, changed signature or type, changed runtime behaviour) needs `!` in the title, a `BREAKING CHANGE:` footer and the PR-body section, all listing the same items.
5. Docs, JSDoc and comments that a change makes false are fixed in the same PR, EN and translated twin. Grep for every symbol or behaviour you change.
6. Stay in scope: no unrelated refactor, no behaviour change hidden in a typing, test or docs commit. Hotspots (`gwen-engine.ts`, `vite/src/index.ts`, `bindings.rs`, `.github/workflows/*.yml`, package `exports`) only for what the spec says.
7. `Closes #N` only if the PR alone finishes the ticket. Otherwise `Part of #N`.
8. Commits are conventional, with no `Co-authored-by` and no AI attribution trailer.
9. Quality gate before every push: `pnpm format`, `pnpm lint`, `pnpm typecheck`, `pnpm test`. Then check the PR's own CI, and that CI checks the artifact that is published.

Write the failing test first. Assert the observable effect, not a mock call. Cover two instances and teardown. `Closes #N` only when every acceptance line is met and CI ran on that head.

`scripts/check-pr-contract.mjs` strips fenced code (a fence indented by at most three spaces; four spaces is text) before the red-proof, review-word, and closing checks. The body has a Red proof table with one row per changed test file. The exact line `Red proof: n/a (no code change)`, and a Red proof table whose every cell is `n/a`, are accepted only when the diff lists at least one path and every path is under `docs/`, ends with `.md`, or is under `.github/`. Any other diff is rejected. A path outside that set requires at least one changed test file. After markdown and punctuation are removed, any line or heading with the word `verdict`, `approve`, `approved`, `self-review`, `self review`, `reviewed-by`, or `reviewed by` is rejected: the review outcome belongs to the maintainer, outside the body. A closing keyword (`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`), including `owner/repo#N` and a GitHub issue or pull URL, is rejected when a table cell says `no test` (any case). The sentence "reviewed by the maintainer, who will approve or not" is not a verdict.

`scripts/verify-red.sh` runs in the CI job `verify-red`, after the `rust` job, with the WASM and build-tools artifacts that job uploads. It copies each changed test file onto a worktree of the pull-request base, runs `pnpm install --frozen-lockfile` there (no build: the Vitest configs alias `@gwenjs/*` to sources), copies the untracked `packages/*/wasm` and `packages/*/build-tools` directories of the checkout into it, and compares results by test name (`node --test --test-reporter=tap`, Vitest JSON, or `cargo test`). A Vitest `.mjs`/`.js` file is one that imports `vitest` at the top level. A test name is its describe path plus its title. A name that is not in the base copy of that file must fail; a new literal name the runner does not report (for example behind an `if`) makes the file not red. A name that already exists on the base may pass, with a warning. A dynamic title (template with `${}`, `it.each` placeholder, variable) is matched as a pattern and, when it passes, is kept with a warning: that and the passing pre-existing name are the limits of the check. A runner name that matches no source name prints a warning. When the file does not load on the base (it imports a module the PR adds), the script runs it on the head: if it loads there, every new name counts red; if it fails there too, it needs something neither tree has and the script exits 2 (`not verifiable`). A file with no describe/it/test call (tests built by a helper) is skipped with a warning. A file under `tests/integration-wasm/` runs with `vitest.wasm.config.ts`; if the config or the `packages/core/wasm/**/gwen_core_bg.wasm` artifact is missing (a local run without `pnpm build:wasm`) and the file adds a test name, the script exits 2. Run `pnpm build:wasm` before a local run of a WASM test.

The label `no-red-check` skips `scripts/verify-red.sh`. It is allowed for a refactor of existing tests or a mechanical typing fix. The reviewer checks why the label was set.

The eight defect classes to make impossible:

- lifecycle methods core never calls
- global defaults that change behaviour
- panic/expect/unwrap in wasm exports
- unprefixed codes and lying comments
- unflagged breaking types
- CI not covering the PR or the shipped artifact
- missing uninstall and finally
- mock-only tests
