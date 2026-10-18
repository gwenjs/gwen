# @gwenjs/docs-check

Private package. It checks documentation fences. It is not published.

## Commands

```sh
pnpm docs:check
pnpm docs:check:wasm
pnpm docs:build
```

`docs:check` runs the unit tests: fence extraction, import names, snippet types, and inert-option phrases. `docs:check:wasm` runs each `ts run` block on a real engine.

## Fence grammar

A `ts` or `typescript` fence may carry `check` or `run`.

````md
```ts check
const ready: number = 1;
```
````

````md
```typescript check
const also: number = 2;
```
````

````md
```ts run
import assert from "node:assert/strict";
assert.equal(engine.state, "idle");
```
````

Untagged fences are examples. They are not type-checked. An `@gwenjs/*` import in them is still checked against the public snapshots.

A tagged block imports every name it uses. The harness injects no Gwen globals.

A `run` block may use one pre-bound `engine`. The harness creates it with `createRealEngine({ variant: "light", maxEntities: 1024 })`, passes it in, and disposes it in a `finally` block. The `light` variant has no physics. Pages about physics use `ts check` only. The block must not call `engine.stop()`. Assertions use `import assert from "node:assert/strict"`. Nothing else is injected.

## Performance claims

`docs-perf-claims.test.ts` reads prose in `docs/` (not `docs/fr`, not `docs/superpowers`), the root `README.md`, the root `CLAUDE.md`, and each `packages/*/README.md`. Fenced code and inline code are skipped. The unit is a paragraph, a list item, or a table row. A table whose header cell is `option`, `default`, `type`, `param`, `parameter`, `field`, or `config` is skipped.

A claim is a number followed within 3 words by `ms`, `µs`, `us`, `ns`, `fps`, `entities`, `bodies`, `calls`, `bytes`, `KB`, or `MB`. A `%` counts when a later word is `faster`, `slower`, `less`, `more`, `overhead`, or `saving`. An `x` or `×` counts when a word in that window is `faster`, `slower`, or `speedup`. A claim is also one of `zero-alloc`, `zero allocation`, `zero overhead`, `no allocations`, `near-zero cost`, or `allocation-free`.

The same unit must contain a markdown link whose path names a file in `packages/docs-check/ci-benches.json`. An ordered-list marker such as `3.` is not a number.

## Deprecated names

`docs-deprecated.test.ts` reads the deprecated public exports the same way as `deprecatedPublicExports` in `packages/core/tests/readme-public-exports.test.ts`. Today that function returns one name. A method tagged `@deprecated` that the function does not return is not in the set.

The name may appear in `docs/` (including `docs/fr`), a README, or the root `CLAUDE.md` only inside a sentence that begins `Deprecated:`. A blank line starts a new sentence. A table row does not. Example:

Deprecated: `useComponentFor` reads one entity and logs `CORE:QUERY_PER_ENTITY_PATH`.
