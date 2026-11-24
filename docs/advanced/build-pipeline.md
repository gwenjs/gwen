---
title: Build Pipeline
description: How GWEN rewrites your source at build time, which calls it recognises, and the errors it can raise.
---

# Build Pipeline

`@gwenjs/vite` rewrites your game source before Vite bundles it. It injects readable names, wraps `await` in context callbacks, and hoists query arrays. You write plain GWEN code. The pipeline does the rest.

## How it works

- **One parse per module.** The `gwen:transform-pipeline` plugin parses each script module once (`packages/vite/src/pipeline/transform-pipeline.ts:182`). Every unit reads that same program.
- **Pure units.** A unit reads the program and returns a list of edits. It never writes the file and never parses again (`packages/vite/src/pipeline/transform-pipeline.ts:209-212`).
- **Edits applied together.** The pipeline collects the edits of every unit, then applies them in one step (`packages/vite/src/pipeline/transform-pipeline.ts:213`). Two edits on the same range raise `VITE:TRANSFORM_EDIT_CONFLICT`.
- **Runs first.** The plugin uses `enforce: "pre"` (`packages/vite/src/pipeline/transform-pipeline.ts:169`), so units see your source before other plugins.
- **Serve equals build.** The `transform` hook runs the same units in `vite dev` and `vite build`. Only the emitted asset files differ: they exist in a build (`packages/vite/src/pipeline/transform-pipeline.ts:195`).
- **No skipped module.** A module that cannot be parsed fails the build with `VITE:TRANSFORM_PARSE_FAILED` (`packages/vite/src/pipeline/parse.ts:69`).

## Units

`BUILT_IN_UNITS` lists the units that always run, in application order (`packages/vite/src/pipeline/registry.ts:10`).

| Unit | What it does |
|---|---|
| `gwen:async-context` | Wraps each `await` inside an async `onEnter`, `onExit`, `onPreload` or `withAsyncContext` handler. |
| `gwen:system-name` | Inserts the variable name into `const Name = defineSystem(setup)`. |
| `gwen:actor-name` | Inserts the variable name into a `defineActor` declaration. |
| `gwen:layout-name` | Names `const Level1 = defineLayout(...)`. |
| `gwen:scene-router-name` | Names `const AppRouter = defineSceneRouter(...)`. |
| `gwen:query-hoist` | Hoists the array of `useQuery([A, B])` to a module constant. |

A plugin can add a unit before `buildStart` with `register()` on the pipeline. The physics plugins do this:

| Unit | Registered by | What it does |
|---|---|---|
| `gwen:layer-inline` | `physics2d` and `physics3d` (`packages/physics2d/src/vite-plugin.ts:68`, `packages/physics3d/src/vite-plugin.ts:181`) | Replaces `L.name`, from `const L = defineLayers({ ... })`, with its numeric value. |
| `gwen:bvh-prebake` | `physics3d`, when `bvhPrebake` is `true` (`packages/physics3d/src/vite-plugin.ts:182`) | Rewrites a relative `.glb` path given to `useMeshCollider`. |

## Which calls are recognised

A unit never matches a call by its text. It resolves the callee through the import binding of the module. A call counts when it resolves to a GWEN export listed in `CANONICAL` (`packages/vite/src/pipeline/canonical.ts:31`).

| Style | Example | Matched |
|---|---|---|
| Named import | `import { defineSystem } from '@gwenjs/core/system'` | Yes |
| Alias | `import { defineSystem as sys } from '@gwenjs/core/system'`, then `sys(...)` | Yes |
| Namespace | `import * as gwen from '@gwenjs/core/system'`, then `gwen.defineSystem(...)` | Yes |
| Auto-import | `defineSystem(...)` with no import, when it is in the auto-import list | Yes |
| Project barrel | `import { defineSystem } from './barrel'` where the barrel re-exports GWEN | Yes |
| Shadowed local | a local `function defineSystem() {}` hides the import | No |
| Member of another object | `utils.defineSystem(...)` where `utils` is not a namespace import | No |
| Another package | `import { defineSystem } from 'some-lib'` | No |

The rules live in `packages/vite/src/pipeline/resolve-callee.ts`: a namespace member needs a namespace import (`:113-115`), a local declaration wins over the import (`:123`), and an auto-import applies only to a name with no declaration (`:122`). A source outside `CANONICAL` never matches (`packages/vite/src/pipeline/canonical.ts:71-78`). The pipeline follows project barrels before units run (`packages/vite/src/pipeline/transform-pipeline.ts:187`). The scanners do not (see below).

## Errors

The pipeline raises these codes. Each page entry gives the cause and the fix.

| Code | When |
|---|---|
| [`VITE:TRANSFORM_PARSE_FAILED`](/api/errors#vite-transform-parse-failed) | A module has a syntax error. The message starts with `<file>:<line>:<column>`. |
| [`VITE:TRANSFORM_EDIT_CONFLICT`](/api/errors#vite-transform-edit-conflict) | Two units edit overlapping ranges in one module. |
| [`VITE:TRANSFORM_UNSUPPORTED`](/api/errors#vite-transform-unsupported) | `register()` is called after `buildStart`, or a unit meets a shape it cannot rewrite, such as a nested `await`. |
| [`VITE:BVH_PREBAKE_FAILED`](/api/errors#vite-bvh-prebake-failed) | The BVH bake of a `.glb` mesh failed. |

## Scanners

Some build steps need facts about many files at once, not a rewrite of one. `@gwenjs/vite/scanners` answers them: scene names, `defineHooks` exports, `defineLayout` names and easing names. The scanners share the pipeline rules:

- They parse with `parseModule`, so a file with a syntax error throws `VITE:TRANSFORM_PARSE_FAILED`. No file is skipped.
- An unreadable file throws the same code. The message is `<file> could not be read.` and `cause` is the Node error (`packages/vite/src/scanners/read.ts:37`).
- They match callees through import bindings. Bare calls need the `autoImports` option.
- They do not follow barrels: `followed` is empty (`packages/vite/src/scanners/read.ts:48`). Import the GWEN function from its package in a scanned file, or rely on auto-imports.

See [`@gwenjs/vite/scanners`](/api/vite#vite-scanners) for the signatures.
