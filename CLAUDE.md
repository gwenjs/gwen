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
       ↕ WASM bridge (typed-array views over WebAssembly.Memory)
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

`scripts/check-pr-contract.mjs` strips fenced code (a fence indented by at most three spaces; four spaces is text; a backtick fence with a backtick in its info string, such as ```` ```note``` ````, is inline code and opens no fence) before the red-proof, review-word, and closing checks. The body has a Red proof table with one row per changed test file. A changed test file is a `*.test.*` / `*.spec.*` file, a Cargo integration test `crates/<crate>/tests/<name>.rs`, a `*_test.rs` file, or any `.rs` file whose diff adds a `#[test]` (or `#[tokio::test]`, `#[wasm_bindgen_test]`, `#[rstest]`, `#[test_case(…)]`) function, also on a one-line `mod tests { #[test] … }`: a Rust-only fix with inline tests needs its Red proof row. The exact line `Red proof: n/a (no code change)`, and a Red proof table whose every cell is `n/a`, are accepted only when the diff lists at least one path and every path is under `docs/`, ends with `.md`, or is under `.github/`. Code is never docs: `.github/workflows/**`, `.github/actions/**`, script files anywhere, `.github/scripts/*.mjs` included (`.js`, `.mjs`, `.cjs`, `.ts`, `.mts`, `.cts`, `.tsx`, `.jsx`, `.vue`, `.sh`), and any `package.json` (`docs/package.json` included) need a changed test file. Any other diff is rejected. A path outside that set requires at least one changed test file. Format characters (`\p{Cf}`: zero-width space, soft hyphen) are removed first. After markdown and punctuation are removed, any line or heading with the word `approve`, `approved`, `self-review`, `self review`, `reviewed-by`, or `reviewed by` is rejected, and so is the word `verdict` in a heading, at the start of a line outside a table, or before a colon. Before `is`, a dash or an em dash it is rejected only when a conclusion follows (`ship it`, `LGTM`, `approve…`, `accept…`, `reject…`, `merge…`, `ready`, `good`, `ok`, `sound`, `solid`, `block…`, `request…`, `needs work`, `go`, `no-go`, `green`, or a bare `pass` / `fail`). Each table cell is read as its own line: a cell that starts or ends with the word is a label, rejected only when its value (the rest of the cell or the next non-empty cell) is such a conclusion (`| Verdict | LGTM |`, `| Reviewer verdict | Ship it |`); `| verdict | string |` passes. Inline code spans are cut out first, so `` `verdict === "pass"` ``, `` `verdict: "pass"` `` and a mid-sentence verdict field pass: the review outcome belongs to the maintainer, outside the body. A closing keyword (`close`, `closes`, `closed`, `fix`, `fixes`, `fixed`, `resolve`, `resolves`, `resolved`), including `owner/repo#N` and a GitHub issue or pull URL, is rejected when a cell of an Acceptance table says `no test`, `no tests`, `no-test`, `notest`, `NO_TEST`, `no automated test`, `not tested`, `not unit-tested`, `not automatically tested`, `untested`, or `no coverage` (any case). The sentence "reviewed by the maintainer, who will approve or not" is not a verdict.

`scripts/verify-red.sh` runs in the CI job `verify-red`, after the `rust` job, with the WASM and build-tools artifacts that job uploads. It copies each changed test file onto a worktree of the pull-request base, runs `pnpm install --frozen-lockfile` there (no build: the Vitest configs alias `@gwenjs/*` to sources), copies the untracked `packages/*/wasm` and `packages/*/build-tools` directories of the checkout into it, and compares results by test name (`node --test --test-reporter=tap`, Vitest JSON, or `cargo test -p <crate> --test <stem>` for a Cargo integration test `crates/<crate>/tests/<stem>.rs`; a test file that does not compile on the base because it uses an API the PR adds is a load error, handled as below). A Vitest `.mjs`/`.js` file is one that imports `vitest` at the top level. A test name is its describe path plus its title. A name that is not in the base copy of that file must fail; a new literal name the runner does not report (for example behind an `if`) makes the file not red. A name that already exists on the base may pass, with a warning. A dynamic title (template with `${}`, `it.each` / `test.for` placeholder such as `%s`, `$name` or `$0`, variable) is matched as a pattern; it may pass only when the base copy of the file has the same title, otherwise it follows the rule of a new name. A runner name that matches no source test name (a renamed or aliased runner such as `import { test as check }` or `const t = test`, `test.extend`, or a helper in another file) blocks when it passes and prints a warning when it fails. When such a name passes, the script also runs the base copy of the file on the base: a name that passes there too is an old test (for example one a helper registers) and only warns. Only a TAP line with children is a suite: `check('A')` next to `describe('A', …)` is a test. The passing pre-existing name is the limit of the check. A changed file with no new name prints `KEEP-ONLY`, not `RED`. When the file does not load on the base (it imports a module the PR adds), the script runs it on the head: if it loads there, every name it reports counts red, including an old name that would pass on the base; if it fails there too, it needs something neither tree has and the script exits 2 (`not verifiable`). A file with no describe/it/test call (all its tests built by a helper) is skipped with a warning. A changed `.rs` file that is not a Cargo integration test but adds a `#[test]` function (inline `#[cfg(test)]` tests) prints `KEEP-ONLY` (not verifiable by test name) and does not block. A file under `tests/integration-wasm/` runs with `vitest.wasm.config.ts`; if the config or the `packages/core/wasm/**/gwen_core_bg.wasm` artifact is missing (a local run without `pnpm build:wasm`) and the file adds a test name, the script exits 2. Run `pnpm build:wasm` before a local run of a WASM test.

The label `no-red-check` skips `scripts/verify-red.sh`. It is allowed for a refactor of existing tests or a mechanical typing fix. The reviewer checks why the label was set.

Limits of these checks (known, not enforced; the reviewer checks them):

- Contract: invisible characters outside `\p{Cf}` (U+034F combining grapheme joiner, U+FE0F variation selector) and homoglyphs (a Cyrillic `А`) hide a review word; a review outcome with none of the listed words (`LGTM, ready to merge`) passes. No-test spellings other than the listed ones (`N/A`, `manual check only`) pass next to a closing keyword. The n/a rule still accepts paths under `.github/` or `docs/` that are not in its code list: `.github/scripts/x.py`, `.rb`, a file with no extension, `docs/tsconfig.json`. The line-start rule outside tables and the colon rule are unconditional and reject some prose (`Verdict field renamed…`, `- verdict of the gate is unchanged`, `The judge returns a verdict: pass or fail.`). The cell, `is`, dash and em dash rules only know the listed conclusion words, read at the start of the value, and a condition or an alternative right after the first word (`ok only when …`, `green or red`, `rejected when …`) is read as field prose. So these self-written outcomes still pass: mid-sentence forms (`My verdict is fine`, `Final verdict — all good`, `My verdict - looks fine`, `My verdict is positive`, `My verdict is to merge`, `My verdict is a pass`, `Final verdict — no blockers`, `The verdict was ship it`, `The verdict is in: ship it`, `My verdict is that it can ship`), emoji (`Our verdict — 👍`, `My verdict is ✅`, `| Verdict | ✅ |`, `| Verdict | 👍 |`, `| Verdict | :white_check_mark: |`), cells (`| Reviewer verdict | Fine |`, `| x | verdict is fine |`), and a label line `Final verdict` with `Ship it` on the next line. True prose still rejected: a bare `pass` / `fail` value (`| row verdict | fail |`).
- verify-red: the base copy of a changed file keeps its file name (the judge picks the Rust or JS scanner from the extension). Inline Rust tests (`#[cfg(test)]` in a source file) are not run per name (`KEEP-ONLY`); the Red proof row is the only evidence. A Cargo test file whose new tests are all `#[wasm_bindgen_test]` or `cfg(target_arch = "wasm32")`, or that runs 0 tests natively on the base and on the head, is `KEEP-ONLY` (not verifiable natively; `wasm-pack test` is not run); its Red proof row is still required, and another group of the same PR still blocks. `#[rstest]` and `#[test_case]` names in a Cargo test file are not placed by the scan: a passing one blocks, a failing one warns. `tests/common/mod.rs` is a helper module, not a test target, and is not a test file. A dynamic title kept from the base hides new values: `for (const n of ['old', 'brandnew']) test(n, …)` when the base has `test(n, …)`, a new row added to an old `test.each` table, and a renamed runner whose title matches an old `test.each('case %s')` pattern or reuses an old literal title all count as kept. A file whose tests all come from a helper is skipped.
- wasm-dispose: flagged although released: engines kept in an array released in `afterEach`, engines from `Promise.all([createRealEngine(), …])`, an index loop (`engines[i].dispose()`), a handle pushed into an array after it is created. Not caught: an engine reached through `H?.createRealEngine` or `H.createRealEngine.bind(H)`, a release in a closure that is never called (`const later = () => handle.dispose();`), and these dead releases: `if ('a' === 'b')`, `(false) ? …`, `false && (handle.dispose())`, `if (!1)`, `if ("")`, `if (NaN)`, a `return` without a semicolon, a `break` before the release in a loop. An engine created in a `beforeEach` callback counts as released by an `afterEach` of the scope that holds that `beforeEach`. A release after `false &&`, `false ?`, behind `if` / `while` with a falsy literal, an always-false `||` or a literal comparison (`0 === 1`), or after `return …;` / `throw …;` in its block does not count. A release behind a condition that tests a binding or a local flag (`if (!disposed)`) counts.

The eight defect classes to make impossible:

- lifecycle methods core never calls
- global defaults that change behaviour
- panic/expect/unwrap in wasm exports
- unprefixed codes and lying comments
- unflagged breaking types
- CI not covering the PR or the shipped artifact
- missing uninstall and finally
- mock-only tests
