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
