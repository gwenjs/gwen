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

`BUILT_IN_UNITS` lists the units that always run, in application order (`packages/vite/src/pipeline/registry.ts:11`).

| Unit | What it does |
|---|---|
| `gwen:async-context` | Wraps each `await` inside an async `onEnter`, `onExit`, `onPreload` or `withAsyncContext` handler. |
| `gwen:system-name` | Inserts the variable name into `const Name = defineSystem(setup)`. |
| `gwen:actor-name` | Inserts the variable name into a `defineActor` declaration. |
| `gwen:layout-name` | Names `const Level1 = defineLayout(...)`. |
| `gwen:scene-router-name` | Names `const AppRouter = defineSceneRouter(...)`. |
| `gwen:query-hoist` | Hoists the array of `useQuery([A, B])` to a module constant. |
| `gwen:hot-path-warn` | Warns when `useQuery`, `useService` or `useWasmModule` is called inside a frame callback. It never edits the source. |

A plugin can add a unit before `buildStart` with `register()` on the pipeline. The physics plugins and `gwen()` do this:

| Unit | Registered by | What it does |
|---|---|---|
| `gwen:layer-inline` | `physics2d` and `physics3d` (`packages/physics2d/src/vite-plugin.ts:68`, `packages/physics3d/src/vite-plugin.ts:181`) | Replaces `L.name`, from `const L = defineLayers({ ... })`, with its numeric value. |
| `gwen:bvh-prebake` | `physics3d`, when `bvhPrebake` is `true` (`packages/physics3d/src/vite-plugin.ts:182`) | Rewrites a relative `.glb` path given to `useMeshCollider`. |
| `gwen:variant-guard` | `gwen()`, once the config is resolved (`packages/vite/src/index.ts:132`) | Raises `VITE:VARIANT_REQUIRED` for a value import of `@gwenjs/physics2d` or `@gwenjs/physics3d` that the resolved variant or `modules` does not allow. It never edits. |

`gwenVitePlugin()` has no resolved config, so it does not run the guard (`packages/vite/tests/transform-pipeline/variant-guard.test.ts:275`). Only modules under the project root are checked.

## Which calls are recognised

A unit never matches a call by its text. It resolves the callee through the import binding of the module. A call counts when it resolves to a GWEN export listed in `CANONICAL` (`packages/vite/src/pipeline/canonical.ts:36`).

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

The rules live in `packages/vite/src/pipeline/resolve-callee.ts`: a namespace member needs a namespace import (`:113-115`), a local declaration wins over the import (`:123`), and an auto-import applies only to a name with no declaration (`:122`). A source outside `CANONICAL` never matches (`packages/vite/src/pipeline/canonical.ts:81-88`). The pipeline follows project barrels before units run (`packages/vite/src/pipeline/transform-pipeline.ts:187`). The scanners do not (see below).

## Per-frame lookups {#per-frame-lookups}

`gwen:hot-path-warn` logs a build warning when `useQuery`, `useService` or `useWasmModule` is called inside the function given to `onBeforeUpdate`, `onUpdate`, `onAfterUpdate` or `onRender` (`packages/vite/src/transforms/hot-path-warn.ts:60`). That function runs every frame, so the lookup does too. The unit reads the source and moves nothing. It logs once per call site, with the code `VITE:HOT_PATH_LOOKUP`, and the build never fails because of it (`packages/vite/src/transforms/hot-path-warn.ts:94`).

The rules:

- Names are the resolved GWEN functions, so an alias such as `useService as svc` is found.
- A `defineSystem` or `defineActor` inside the callback has its own setup. A lookup in that setup is not reported.
- Another function inside the callback, such as `forEach(() => ...)`, does not change the answer: the lookup is still per frame.
- A lookup in the arguments of the frame call, as in `onUpdate(useService("k").tick)`, runs once and is not reported.
- A function reference, as in `onUpdate(tick)`, has no body to read here, so nothing is reported.

Call the lookup once in the setup and use the captured value in the callback. For a service that may be absent or swapped, keep `optionalService(engine, key)` from the setup and read `.current` in the callback:

```ts
import { useEngine } from "@gwenjs/core";
import { defineSystem, onUpdate } from "@gwenjs/core/system";
import { optionalService } from "@gwenjs/kit/plugin";

export const Audio = defineSystem("Audio", () => {
  const audio = optionalService(useEngine(), "audio");
  onUpdate(() => {
    audio.current?.play("tick");
  });
});
```

Each transform of a module logs its own warnings (`packages/vite/src/pipeline/transform-pipeline.ts:335`), so a re-transform in `vite dev` logs them again.

## Opting out {#opting-out}

`// @gwen-no-optimize` turns the optimisation units off where it applies (`packages/vite/src/pipeline/opt-out.ts:27`). Only `gwen:query-hoist` (`packages/vite/src/transforms/query-hoist.ts:191`) and `gwen:hot-path-warn` (`packages/vite/src/transforms/hot-path-warn.ts:70`) read it.

- **Exact token.** The comment text must be `@gwen-no-optimize` and nothing else. `// @gwen-no-optimize-later` and `// @gwen-no-optimize please` are not directives (`packages/vite/src/pipeline/opt-out.ts:32`).
- **Comment forms.** `// ...` and `/* ... */` work. A JSDoc `/** ... */` does not.
- **Whole module.** A directive before the first statement of the module, including the leading comment of that statement, covers the whole module (`packages/vite/src/pipeline/opt-out.ts:38`).
- **One node.** Elsewhere, a directive covers the node that follows it: a top-level statement, a frame call such as `onUpdate(...)`, or a statement inside a callback. For `gwen:hot-path-warn`, a directive above a statement inside a callback silences the lookups in that statement. For `gwen:query-hoist`, a directive counts on the top-level statement that holds the call, on the `useQuery(...)` call itself, or before the first statement; a directive on an inner statement of a callback silences `gwen:hot-path-warn` only. `isOptedOut` answers for the node it receives and does not consult its ancestors: each unit checks the enclosing nodes it cares about (`packages/vite/src/pipeline/opt-out.ts:41`).
- **Leading comment only.** Only the comment right before the node counts. If another comment sits between the directive and the node, the directive does not apply.

```ts
export const Audio = defineSystem("Audio", () => {
  onUpdate(() => {
    // @gwen-no-optimize
    const sfx = useService("audio");
  });
});
```

The other units do not read the directive: `gwen:async-context` wraps `await`, the name units insert names and `gwen:variant-guard` protects the build, so they are not optimisations. Kit source transforms do not see it: only the internal pipeline context has `isOptedOut` (`packages/vite/src/pipeline/types.ts:86`).

## Errors

The pipeline raises or logs these codes. Each page entry gives the cause and the fix.

| Code | When |
|---|---|
| [`VITE:TRANSFORM_PARSE_FAILED`](/api/errors#vite-transform-parse-failed) | A module has a syntax error. The message starts with `<file>:<line>:<column>`. |
| [`VITE:TRANSFORM_EDIT_CONFLICT`](/api/errors#vite-transform-edit-conflict) | Two units edit overlapping ranges in one module. |
| [`VITE:TRANSFORM_UNSUPPORTED`](/api/errors#vite-transform-unsupported) | `register()` is called after `buildStart`, or a unit meets a shape it cannot rewrite, such as a nested `await`. |
| [`VITE:BVH_PREBAKE_FAILED`](/api/errors#vite-bvh-prebake-failed) | The BVH bake of a `.glb` mesh failed. |
| [`VITE:VARIANT_REQUIRED`](/api/errors#vite-variant-required) | A module value-imports `@gwenjs/physics2d` or `@gwenjs/physics3d` that the resolved variant or `modules` does not allow. |
| [`VITE:HOT_PATH_LOOKUP`](/api/errors#vite-hot-path-lookup) | A warning, not an error: a lookup runs inside a frame callback. The build goes on. |

## Scanners

Some build steps need facts about many files at once, not a rewrite of one. `@gwenjs/vite/scanners` answers them: scene names, `defineHooks` exports, `defineLayout` names, easing names and `loadWasmModule` names. The scanners share the pipeline rules:

- They parse with `parseModule`, so a file with a syntax error throws `VITE:TRANSFORM_PARSE_FAILED`. No file is skipped.
- An unreadable file throws the same code. The message is `<file> could not be read.` and `cause` is the Node error (`packages/vite/src/scanners/read.ts:39`).
- They match callees through import bindings. Bare calls need the `autoImports` option. The exception is `scanWasmModuleNames`: it matches the method name `loadWasmModule` on any object.
- They do not follow barrels: `followed` is empty (`packages/vite/src/scanners/read.ts:50`). Import the GWEN function from its package in a scanned file, or rely on auto-imports.

See [`@gwenjs/vite/scanners`](/api/vite#vite-scanners) for the signatures.
