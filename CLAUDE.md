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
