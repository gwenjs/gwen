---
title: Source Transforms
description: Write a module that rewrites source files at build time with kit.addSourceTransform, without importing the Vite package.
---

# Source Transforms

A source transform rewrites the source of your game at build time. A module registers it with `kit.addSourceTransform`. The transform reads a parsed program and returns edits. It never imports `@gwenjs/vite` and never imports a parser.

This page shows one small plugin, `tint`. It replaces `defineTint("red")` with the color number. Then it explains the contract member by member.

## How the pipeline works {#pipeline-model}

The framework registers one Vite plugin, `gwen:transform-pipeline`, with `enforce: "pre"`. It runs before Vite's normal plugins.

For each module the pipeline does this:

1. It skips ids that start with `\0`, ids inside `/node_modules/`, and files that are not scripts.
2. It parses the module once. Every transform shares that one program.
3. It runs each transform in order. A transform reads the original source and returns edits.
4. It applies all edits together on one `MagicString`, and returns the new code with a source map.

Two rules follow from this.

- A transform never sees the output of another transform. Every transform gets the original `code` and the original offsets.
- Two edits that touch the same range fail the build with `VITE:TRANSFORM_EDIT_CONFLICT`. An insert exactly at the start or the end of another edit is not a conflict. Two inserts at the same offset keep the order of the transforms.

The pipeline runs the same way in `vite dev` and in `vite build`. One call is build only: `ctx.emitAsset`.

## An example plugin {#example}

The plugin has two files. `tint.ts` is the runtime. It exports `defineTint`.

```ts check
export const tintRed = 16711680;
export const tintGreen = 65280;
export const tintBlue = 255;

/** Returns the color number for a known name, or 0 for any other string. */
export function defineTint(color: string): number {
  if (color === "red") return tintRed;
  if (color === "green") return tintGreen;
  if (color === "blue") return tintBlue;
  return 0;
}
```

`module.ts` holds the transform and the module. The module only calls `kit.addSourceTransform`.

```ts check
import {
  defineGwenModule,
  type GwenCallSite,
  type GwenSourceTransform,
  type GwenTransformEdit,
} from "@gwenjs/kit/module";

function tintNumber(color: string): number | undefined {
  if (color === "red") return 16711680;
  if (color === "green") return 65280;
  if (color === "blue") return 255;
  return undefined;
}

function isTintCall(call: GwenCallSite): boolean {
  const binding = call.binding;
  if (binding === null) return false;
  return binding.source === "@example/tint" && binding.imported === "defineTint";
}

/** Build transform `tint:inline`. A dynamic argument is left as a runtime call. */
export const tintTransform: GwenSourceTransform = {
  name: "tint:inline",
  run(_program, ctx) {
    const edits: GwenTransformEdit[] = [];
    for (const call of ctx.calls()) {
      if (!isTintCall(call)) continue;
      const arg = call.arguments[0];
      if (arg === undefined || arg.kind === "other") continue;
      if (arg.kind !== "string") continue;
      const color = tintNumber(arg.value);
      if (color === undefined) {
        ctx.raise("TINT:UNKNOWN_COLOR", arg, `Unknown tint color "${arg.value}".`, {
          composable: "defineTint",
        });
      }
      edits.push({ kind: "overwrite", start: call.start, end: call.end, text: String(color) });
    }
    return edits;
  },
};

/** `@example/tint` module. `setup` only calls `kit.addSourceTransform`. */
export const tintModule = defineGwenModule({
  meta: { name: "@example/tint" },
  setup(_options, kit) {
    kit.addSourceTransform(tintTransform);
  },
});

export default tintModule;
```

Both files compile in the docs check, and the build pipeline runs them in a test. The module imports only from `@gwenjs/kit/module`.

What the plugin does:

- `defineTint("red")` becomes the color number `16711680`.
- A call with a dynamic argument, such as `defineTint(color)`, stays a runtime call.
- A name that is not a known color stops the build with `TINT:UNKNOWN_COLOR`. The error carries the file, the line and the column of the argument.

The package `@example/tint` exports `tint.ts` as its runtime. List the module in `gwen.config.ts`, or place `module.ts` in `src/modules`.

## The contract {#contract}

The types come from `@gwenjs/kit/module`. They are also exported by `@gwenjs/schema`. A transform has a `name` and a `run` function. `run` receives the program and a context.

All offsets are indexes into the original source text. A transform must not change the program, a call site, or a node. Edits are its only output.

### `ctx.id` {#ctx-id}

The id of the module being transformed. It is the module id that Vite passes to the pipeline.

### `ctx.code` {#ctx-code}

The original source text of the module. Edit offsets point into this string.

### `ctx.calls()` {#ctx-calls}

Returns every call expression of the module, in source order. The list is computed once and reused by every transform.

Each call site has `start`, `end`, `arguments`, `node` and `binding`. `binding` holds the `source` and the `imported` name when the callee is an import. It is `null` when it is not. See [Matching calls](#matching) for the rules.

An argument has a `kind`. A string literal gives `kind: "string"` with its `value`. A number literal gives `kind: "number"`. Anything else gives `kind: "other"` with its `node`.

### `ctx.resolveImport(node)` {#ctx-resolve-import}

Resolves any node of the program to the import it comes from. It returns a `binding`, or `null`. Use it on a node you found with `ctx.walk`. The node is found by its `type`, `start` and `end`. An identifier, a member access, a call or a chain can resolve. Any other node gives `null`.

### `ctx.walk(visit)` {#ctx-walk}

Visits every node of the program. `visit(node, parent)` gets the node and its parent, or `null` at the root. Return `"skip"` to skip the children of that node. Nodes expose `type`, `start` and `end`. Every other field is `unknown`.

### `ctx.raise(code, at, what, options?)` {#ctx-raise}

Stops the build. It throws an error with your `code`, built from `what`. The error carries the file, the line and the column of `at.start`. The call never returns.

`options.composable` names the API that failed. `options.hint` adds a fix hint, shown outside production builds.

The code must look like `NAMESPACE:REASON`. Use upper case letters, digits and `_`, with exactly one `:`. A framework prefix, or a code that does not have this form, is refused with `VITE:TRANSFORM_UNSUPPORTED`. See [Errors](#errors).

### `ctx.warn(code, at, what, options?)` {#ctx-warn}

Logs a warning with the same location, and does not stop the build. The same rules apply to the code and the options.

### `ctx.emitAsset(name, source)` {#ctx-emit-asset}

Adds a file to the build output and returns its name. It works in a build only. In `vite dev` it throws `VITE:TRANSFORM_UNSUPPORTED`.

### `name` {#transform-name}

The name of the transform: `<namespace>:<transform>`, in lower case. Each part starts with a letter, then holds letters, digits and `-`. The namespace `gwen` is reserved for built-in transforms. Two transforms cannot share a name.

`kit.addSourceTransform` checks the name when the module sets up. A bad name fails at once with `KIT:SOURCE_TRANSFORM_INVALID`.

### `run(program, ctx)` {#transform-run}

Receives the root node of the program and the context. It returns an array of edits, or a promise of one.

An edit is one of three kinds:

- `{ kind: "insert", at, text }` adds text at an offset.
- `{ kind: "overwrite", start, end, text }` replaces a range.
- `{ kind: "remove", start, end }` deletes a range.

The pipeline checks each edit. A broken edit fails with `VITE:TRANSFORM_UNIT_FAILED` and the message `Transform "<name>" failed on <id>.`. Its `cause` holds one of these messages:

- `edit is not an object.`
- `edit kind is not insert, overwrite, or remove.`
- `edit offsets are out of range.` An offset must be an integer between zero and the length of the source.
- `edit range is empty.` An overwrite or a remove needs `start` below `end`.
- `edit start is after its end.`
- `insert offset is out of range.`
- `insert text is not a string.`
- `overwrite text is not a string.`

If `run` throws an error that is not a `GwenError`, the pipeline wraps it. The cause is kept.

## Matching calls {#matching}

`ctx.calls()` lists every call expression. Calls in comments and strings never appear, because they are not calls in the program.

`binding` follows the import, not the name you typed. This source uses four forms of the same import. A fifth call has a local name that hides the import.

```ts
import { defineTint as paint } from "@example/tint";
import * as tint from "@example/tint";
import { defineTint } from "./barrel.js";

export const aliased = paint("red");
export const namespaced = tint.defineTint("green");
export const barreled = defineTint("blue");

export function shadowed(defineTint) {
  return defineTint("red");
}

export function dynamic(color) {
  return defineTint(color);
}
```

Here `barrel.js` holds `export { defineTint } from "@example/tint";`. The `tint` plugin gives this result:

| Source | Result |
|--------|--------|
| `paint("red")` | `16711680` |
| `tint.defineTint("green")` | `65280` |
| `defineTint("blue")` from the barrel | `255` |
| `defineTint("red")` on a parameter named `defineTint` | unchanged |
| `defineTint(color)` | unchanged |

The rules, in short:

- An alias resolves to the imported name. `paint` gives `imported: "defineTint"`.
- A namespace member, such as `tint.defineTint`, resolves when the access is not computed and not optional.
- A barrel file of the project (a relative path or a Vite alias, inside the root) that re-exports the name is followed to its origin, up to a fixed depth. A namespace import of a barrel is not followed.
- A name used with no declaration resolves through the auto-imports, when one declares it.
- An optional call, such as `defineTint?.("red")`, has no binding.
- A local name that hides the import has no binding.
- A type-only import has no binding. Type-only imports are left out of the import table.
- A call whose callee is not an import has `binding: null`. It still appears in the list.

A transform that matches on `binding` handles every form with one check. A transform that matches on the callee name misses most of them.

## Ordering {#ordering}

The pipeline builds its list of transforms in three groups:

1. The built-in transforms of the framework.
2. The transforms registered by modules, in module order.
3. The units that other Vite plugins register on the pipeline before the build starts.

Module order is the order of `modules` in `gwen.config.ts`, then the modules of `src/modules`. Framework modules run first. A module name is used once: a second module with the same `meta.name` is ignored.

The list is frozen at `buildStart`. A transform registered after that point is refused with `VITE:TRANSFORM_UNSUPPORTED`.

Order rarely matters. Transforms never see each other's output, so only the offsets decide. When two inserts land on the same offset, the earlier transform comes first in the output.

## Errors {#errors}

| Code | Raised when | Message |
|------|-------------|---------|
| [`KIT:SOURCE_TRANSFORM_INVALID`](/api/errors#kit-source-transform-invalid) | The name is not `<namespace>:<transform>` in lower case, the namespace is `gwen`, or `run` is not a function. | `Source transform "<name>" is invalid: <reason>.` |
| [`KIT:SOURCE_TRANSFORM_DUPLICATE`](/api/errors#kit-source-transform-duplicate) | A name is registered twice. | `Source transform "<name>" is already registered by module "<first>".` |
| [`VITE:TRANSFORM_PARSE_FAILED`](/api/errors#vite-transform-parse-failed) | The parser rejects the module. | `<id>:<line>:<column> <message>.` |
| [`VITE:TRANSFORM_EDIT_CONFLICT`](/api/errors#vite-transform-edit-conflict) | Two edits touch the same range. | `<a> [s-e] and <b> [s-e] edit the same range in <id>.` |
| [`VITE:TRANSFORM_UNSUPPORTED`](/api/errors#vite-transform-unsupported) | A transform raises or warns a code with a framework prefix or a code that is not `NAMESPACE:REASON`, calls `emitAsset` outside a build, registers after `buildStart`, or registers a name that another unit already holds. | One message per cause, listed below the table. |
| [`VITE:TRANSFORM_UNIT_FAILED`](/api/errors#vite-transform-unit-failed) | An edit is broken, or `run` throws an error that is not a `GwenError`. | `Transform "<name>" failed on <id>.` |
| `TINT:UNKNOWN_COLOR` | The example gets a color it does not know. | `Unknown tint color "<value>".` |

The last row is the code of the example. It is yours to define. The other rows are framework codes; follow each link for the cause and the fix.

Each Message cell is the `what` part. The full message is `[<composable>()] <what>`, or `[GWEN] <what>` when no composable is set. Then comes an optional `Fix:` line, then a `See` line.

`VITE:TRANSFORM_UNSUPPORTED` has one message for each cause:

- A code with a framework prefix, or not `NAMESPACE:REASON`: `Transform "<name>" raised "<code>", which is not one of its own codes.`
- `ctx.emitAsset` outside a build: `emitAsset is only available in a build.`
- A registration after `buildStart`: `register() was called after buildStart.`
- A name that another unit already holds: `register() was called with a different unit named <name>.`

The reasons of `KIT:SOURCE_TRANSFORM_INVALID` are:

- `the name must be "<namespace>:<transform>" in lower case`
- `the "gwen:" namespace is reserved for built-in transforms`
- `run is not a function`

A code that you raise or warn must follow `NAMESPACE:REASON`. These prefixes belong to the framework and are refused: `CORE`, `SCHEMA`, `KIT`, `APP`, `VITE`, `MATH`, `RENDERER`, `CAMERA`, `PHYSICS2D`, `PHYSICS3D` and `CONFORMANCE`. Pick your own prefix, as the example does with `TINT`.

## Testing a transform {#testing}

Test a transform on the real pipeline. A hand-built context cannot prove the matching rules, the offsets or the error location.

The repo does it this way in `packages/vite/tests/transform-pipeline/kit-transform.test.ts`:

1. Create a temporary project with a `src` folder, a `gwen.config.ts` and your module.
2. Call `gwen()` from `@gwenjs/vite`. A test may import it, a plugin may not. Run the config hook of the `gwen` plugin with the project root. It loads your module and registers its transform.
3. Pass the `gwen:transform-pipeline` plugin to Vite's `createServer`, with `appType: "custom"` and `server: { middlewareMode: true }`.
4. Write a source file, call `server.transformRequest` on it, and read `result.code`.
5. Assert on the new code. For a failure, catch the error and assert on its code, its location, and the `what` text inside its message.
6. Close the server and delete the project in `finally`.

The page you are reading is tested the same way. A vite test writes the two files above into a project and runs the sample source of the matching section through the pipeline.

## Limits {#limits}

- A transform never imports `@gwenjs/vite`. It also needs no parser: the program and the context are enough.
- `gwenVitePlugin()` runs the built-in transforms only. It does not load modules, so a kit transform does not run through it. Use `gwen()`.
- `ctx.emitAsset` works in a build only.
- A code that raises or warns with a framework prefix is refused.
- Names in the `gwen:` namespace are reserved.
- A transform edits the original source only. It cannot read or change what another transform wrote.

See [Writing a Custom Module](/kit/custom-module) for the rest of the `kit` API and [Errors](/api/errors) for every error code.
