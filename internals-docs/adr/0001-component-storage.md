# ADR-0001 — Component storage

Contributor note. Not an end-user guide.

## Status

Accepted. 2026-10-04. Owner: Jonathan Moutier.

The benchmark records the cost. It does not reopen the choice.

## Context

Contributor docs described `Position.x[entityId]`: one typed array per field, indexed by entity id. `ComponentDefinition` has no field arrays. The TypeScript registry is a `Map` per component type. `addComponent`, `getComponent`, and `removeComponent` do not write the WASM store.

The Rust store is already archetype tables. One column per component. Each row packs that component's fields. JS-registered columns are variable-size. Adding or removing a component copies the whole entity through a `HashMap`. The archetype mask is `BitSet128` (128 component types). Query results are one flat list of entity ids, with no chunk boundary.

`defineComponent` still stores a packed-row layout (`_byteSize`, `_f32Stride`, `_fields[].byteOffset`) and a module-level `_typeId`.

## Decision drivers

- Iteration dominates frame time. The hot path must stay cache-friendly.
- A system must read and write fields with no per-element boundary crossing.
- Two components in one chunk must share one row index. No stride. No sparse join on that path.
- Add and remove stay explicit structural changes, not work inside the row loop.
- #65, #56, #53, and #113 must be able to name the same model.

## Considered options

### A — Archetype tables, packed rows

Today's Rust layout. One column per component. Fields of one component sit in the same row, so access is `data[row * stride + offset]`.

This keeps `ArchetypeStorage` and the archetype graph. It does not give #65 a plain typed array per field. A `bool` makes the f32 stride fractional. `vec2` fields interleave. #113's outcome ("one contiguous array per field") would be false under this layout.

### B — One sparse set per component, per-field arrays

Each component has dense per-field arrays and a sparse slot-to-dense index. Add and remove are O(1). The 128-type cap goes away. There is no archetype migration.

A query over two components looks up the second component per row. Those elements are not contiguous for the query. Entity ids are `bigint`, so a per-entity index is not the dense slot. #65's chunk contract would have to be redesigned. #113 would have nothing to implement.

### C — Archetype tables, one array per field per chunk

Keep the archetype graph, migration on add/remove, and `BitSet128`. Each field in a chunk is its own fixed-size array, in row order. Every component in the chunk shares that row.

Access is `chunk.get(Def).field[row]`. No stride. No indirect lookup inside the row loop. #65 fits as written. #113 is the Rust change. #56 keeps a dormant flag instead of migrating. #53 rebuilds views when storage grows.

## Decision

**C.** Archetype tables with one typed array per field inside each chunk.

`A.direct` and `C` differ only in layout. On the native host at E = 10 000, C's Movement pass is slower than both `A.direct` and `B` (1.171 ns/entity against 1.035 and 0.9465). The direction stays C. Iteration in the JS stand-ins does not show that gap: JS `C` is the fastest of the JS models at E = 10 000. Absolute WASM numbers are out of scope here. #113 records them in [Before/after (#113)](#beforeafter-113).

## Reference scene

`STORAGE_REFERENCE_SCENE` in the Rust and TypeScript benches. Both files point here.

- E is 1 000 and 10 000.
- Every entity has `Position { x, y: f32 }` and `Velocity { vx, vy: f32 }`.
- Every 2nd entity has `Health { current, max: f32 }`.
- Every 4th entity has an `Enemy` tag (`schema: {}`).
- That is 4 archetypes.

One frame, in order, with no RNG:

1. Movement over `[Position, Velocity]` for all E: `x += vx * dt`, `y += vy * dt`.
2. Regen over `[Health]` for E/2: `current += dt`.
3. E/200 removes of `Health` and E/200 adds of `Health`, on deterministic indices.

`dt` is `1/60`. Rust stores it as `f32`. The JS models use `Math.fround(1/60)`.

## Measured numbers

Local run of `cargo bench -p gwen-core --bench storage_models` and `vitest bench bench/storage-models.bench.ts`. Same warm-up and measurement flags as the `storage-bench` CI job for Rust (warm-up 1s, measurement 3s, 10 samples). JS iteration samples run for about 200 ms. JS add, remove, and frame use 30 measured iterations.

- CPU: Apple M4 Max
- OS: Darwin 25.6.0 arm64
- rustc: rustc 1.90.0 (1159e78c4 2025-09-14)
- Node: v24.7.0
- Commit: 72b19e79ebd6d8637a33534a776a6fd25e174bc7
- CI run: local run (no CI URL). The PR job `storage-bench` repeats this table on GitHub.

Native rows are Rust on the host target, not wasm32. Ranking only. `today` and JS `A` / `B` / `C` are Node.

JS `A` is the strided packed-row stand-in for Rust `A.direct`. There is no separate JS `A.prod`. Rust `A.prod` calls the public per-entity API, including today's `HashMap` migration. Its byte count is component payload visible through that API, not allocator capacity.

JS `A` / `B` / `C` bytes are the `WebAssembly.Memory` allocation, rounded up to 64 KiB pages. `today` bytes are the Node `heapUsed` delta around spawn. That delta is not a column size. Do not compare it with the other byte columns.

`iter_ns_per_entity` is the median Movement pass divided by E. `add_us` and `remove_us` are the median of one structural op. `frame_us` is the median of one reference frame.

| model | runtime | E | iter_ns_per_entity | add_us | remove_us | frame_us | bytes_per_entity |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| today | JS | 1000 | 104.2 | 0.3750 | 0.3335 | 379.3 | 1597.6 |
| today | JS | 10000 | 116.1 | 0.4795 | 0.3960 | 4132.3 | 148.0 |
| A | JS | 1000 | 1.375 | 0.6250 | 0.7500 | 8.980 | 131.1 |
| A | JS | 10000 | 1.308 | 0.2910 | 1.292 | 35.000 | 104.9 |
| B | JS | 1000 | 2.292 | 0.08300 | 0.1250 | 3.542 | 65.536 |
| B | JS | 10000 | 2.333 | 0.04200 | 0.08300 | 26.958 | 58.982 |
| C | JS | 1000 | 1.000 | 0.7090 | 0.6875 | 6.480 | 131.1 |
| C | JS | 10000 | 0.9458 | 0.4580 | 0.5000 | 31.001 | 104.9 |
| A.prod | native Rust | 1000 | 4.569 | 0.1703 | 0.1640 | 8.683 | 24.000 |
| A.prod | native Rust | 10000 | 4.738 | 0.1875 | 0.1788 | 87.873 | 24.000 |
| A.direct | native Rust | 1000 | 1.003 | 0.02001 | 0.02107 | 1.349 | 33.376 |
| A.direct | native Rust | 10000 | 1.035 | 0.01970 | 0.01992 | 13.020 | 47.402 |
| B | native Rust | 1000 | 0.7029 | 0.01611 | 0.01503 | 0.7706 | 48.128 |
| B | native Rust | 10000 | 0.9465 | 0.01599 | 0.01495 | 9.316 | 77.005 |
| C | native Rust | 1000 | 1.090 | 0.02075 | 0.02133 | 1.253 | 33.280 |
| C | native Rust | 10000 | 1.171 | 0.02038 | 0.02090 | 13.799 | 47.392 |

## Consequences

**Positive**

- A chunk's fields are contiguous per column. The row loop is a typed-array walk.
- All defs in the chunk share one row. The optimizer can hoist `chunk.get(D)` out of that loop (#69). No stride or byte offset is emitted.
- Archetype masks and migration stay. Matching does not become a join.

**Negative**

- Row identity is not stable. A row index dies on the next migration.
- Add and remove move each kept column once. That cost is outside the row loop, and it is not free. Native `B` is faster at both add/remove and, at E = 10 000, Movement.
- Native C iteration at E = 10 000 is the gap recorded above. The choice is still C.
- The 128-type cap stays.
- `string` fields become a string-pool index. `i64` and `u64` are stored and have no view (#65).

**Not in this change**

- Rust columns, chunk exports, and `defineComponent` metadata are #113.
- `Query` / `QueryChunk` and the user docs are #65 and #62.
- `queryReadBulk` and `queryWriteBulk` are superseded. They stay until that work removes them.
- Prototypes of B and C live only under the benches. They are not crate API.

## Access API

The only form for systems:

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

`chunk.get(Def).field[row]` is the form. `chunk.x[i]` is not an API. Two defs can share a field name.

`Position.x[id]` and `Position.x[i]` are not APIs. `ComponentDefinition` has no field keys. Those lines are a TS2339. The type test is `packages/core/tests/types/component-access.test.ts`. The `chunk.*` forms are tested in #65.

Identity comes only from `chunk.entityId(row)`.

Slow path, per entity: `query.each()` and `useComponent(id, def)`. Outside systems: `engine.getComponent` and `engine.addComponent`.

This tree does not implement the chunk loop yet. #113 and #65 do. Until they land, the snippet above is the contract, not a sample that runs here.

## Invariants

- Row order inside a chunk is unspecified.
- Writes go in place. They do not allocate a new row.
- Structural add/remove is deferred while a row loop is open.
- Dormant rows sit outside `[0, count)`.
- Views are rebuilt after storage growth, through a per-engine epoch (#53).
- More than 128 component types is `CORE:COMPONENT_TYPE_LIMIT_REACHED`. Today's Rust path still asserts in `component.rs` (`Maximum of 128 component types exceeded`). This ticket does not change that assert.

## Follow-ups

- #113 — Rust columns, one array per field, chunk export, `CoreError` on fallible paths. Fills [Before/after (#113)](#beforeafter-113).
- #65 — `useQuery` returns `Query`, `QueryChunk`, and `chunk.get(def)`.
- #56 — Dormancy without adding or removing a component.
- #53 — Growth-safe views, rebuilt from the engine epoch.
- #59 — Per-engine component type ids. Replaces the module `_typeId` counter.
- #62 — User docs. Replaces `Position.x[id]` with the chunk form.
- #69 — `hoistChunkColumns`. Valid only because a chunk's arrays stay put for one loop step.
- #95 — `archetypeCount` becomes meaningful once #113 lands. The stat stays owned by #95.

## Before/after (#113)
