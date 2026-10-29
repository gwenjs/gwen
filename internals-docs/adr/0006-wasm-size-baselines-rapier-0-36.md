# ADR 0006 — WASM size baselines after Rapier 0.36.1

Contributor note. Not an end-user guide.

## Status

Accepted. 2026-10-27. Owner: Jonathan Moutier.

ADR 0003 is not used by this record. It stays reserved for the profile matrix of #93.

Supersedes no ADR. Re-open with a new ADR when a Rapier release changes the size of the binaries, or when a lever below is adopted.

## Context

The upgrade from Rapier 0.22 to 0.36.1 (#286, PR #357, commit `5c1d9fe6`) made the three physics binaries grow.
`crates/gwen-core/Cargo.toml` pinned `rapier2d` and `rapier3d` at `0.22` before the upgrade (`crates/gwen-core/Cargo.toml:18` and `:23` at `5c1d9fe6~1`). It pins `0.36.1` now (`crates/gwen-core/Cargo.toml:18`, `:24`).

The job `WASM size budget` is red on the push to `v1-alpha`.
Source: CI push run 40543934748, commit `26a26417`, job 122330984921.
Command: `gh run view 40543934748 --repo gwenjs/gwen --job 122330984921 --log`.

The Rapier features changed with the upgrade. `std` is new:

- Before: the features were `f32` and `dim2` or `dim3` (`git show 5c1d9fe6~1:crates/gwen-core/Cargo.toml`, lines 18-21 and 23-26). `rapier2d-0.22.0/Cargo.toml:131-163` has no `std` or `alloc` feature.
- After: the features are `std`, `f32` and `dim2` or `dim3` (`crates/gwen-core/Cargo.toml:18-22`, `:24-28`).
- In 0.36.1, `std` pulls `alloc`, `parry2d/std`, `parry2d/spade`, `nalgebra/std` and `simba/std` (`rapier2d-0.36.1/Cargo.toml:95-100`).
- This record does not claim that `std` caused any part of the growth. The attribution in "Causes" does not isolate it. It is a feature change that came with the upgrade.

What did not change:

- `default-features = false`, `f32` and `dim2` or `dim3` (`crates/gwen-core/Cargo.toml:18-22`, `:24-28`; `git show 5c1d9fe6~1:crates/gwen-core/Cargo.toml`, lines 18-21 and 23-26).
- The 3D build enables `rapier3d/serde-serialize` (`crates/gwen-core/Cargo.toml:54`; `git show 5c1d9fe6~1:crates/gwen-core/Cargo.toml`, line 52).
- The release profile is tuned for size: `opt-level = "z"`, `lto = true`, `codegen-units = 1`, `strip = true`, `panic = "abort"` (`Cargo.toml:14-18`).
- `wasm-opt` runs as `-Oz`, without `--converge` (`scripts/build-wasm.sh:135`).

The budget of a variant is its baseline plus 5 %, at least 2048 bytes (`wasm-size.json:22-23`, `scripts/check-wasm-size.mjs:15-16`). A binary that doubles is far outside it.

## Decision

The maintainer accepts the cost. It is intended. Decision of 2026-10-27: "on accepte le coût, c'est voulu".

- The baselines and budgets of `physics2d`, `physics3d` and `physics3d-bvh` are re-recorded from CI run 40543934748 (`wasm-size.json:31-42`, `:61-66`).
- The budgets stay baseline + 5 %, computed with `allowedBudget` (`scripts/check-wasm-size.mjs:33-35`). The tolerance is not changed.
- No code, feature or profile is changed to win the bytes back. The levers are in "Levers tested".
- This record is `Part of #286`. It does not close it.

## Measurements

Source: CI run 40543934748, job 122330984921. Before: the values of `wasm-size.json` at `26a26417` (`wasm-size.json:31-42`, `:61-66`).

| variant | metric | before | after | change |
| --- | --- | --- | --- | --- |
| physics2d | gzip | 197988 | 427612 | +116.0 % |
| physics2d | brotli | 159454 | 339179 | +112.7 % |
| physics2d | raw | 469784 | 994611 | +111.7 % |
| physics3d | gzip | 292045 | 568084 | +94.5 % |
| physics3d | brotli | 228488 | 439634 | +92.4 % |
| physics3d | raw | 691061 | 1317219 | +90.6 % |
| physics3d-bvh | gzip | 394871 | 673104 | +70.5 % |
| physics3d-bvh | brotli | 304560 | 516185 | +69.5 % |
| physics3d-bvh | raw | 948573 | 1575381 | +66.1 % |

New budgets, gzip / brotli (`wasm-size.json:31-42`, `:61-66`):

| variant | gzip budget | brotli budget |
| --- | --- | --- |
| physics2d | 448993 | 356138 |
| physics3d | 596489 | 461616 |
| physics3d-bvh | 706760 | 541995 |

Proof of the re-record: `node scripts/check-wasm-size.mjs` run against the artifacts of that run fails with `over` on the three variants and the old file. It passes with the new file. The run used a scratch root outside the repo. See the PR body.

## Causes

Measured by a research agent on 2026-10-27 with twiggy on a local rebuild within 0.02-0.11 % of CI; not re-run in this PR.
The split is on raw bytes, not gzip.
The `physics3d-bvh` variant was not rebuilt. Only its CI figures are known.

**physics2d, +523 530 raw:**

| group | raw bytes | share |
| --- | --- | --- |
| soft-body code (`soft_body`, `soft_constraint`, `soft_contacts`, `collision_mesh`) | +160 156 | 30.6 % |
| inlined pipeline step | +151 952 | 29.0 % |
| parry (BVH, Voronoi manifolds) | +101 968 | 19.5 % |
| `.rodata` | +29 991 | 5.7 % |
| new `staged_island_solver` | +27 517 | 5.3 % |
| rest of rapier | +20 987 | |
| hashbrown, core, alloc | +22 511 | |
| math crates | -3 228 | -0.6 % |

**physics3d, +607 873 raw:** soft-body code +183 731 (30.2 %), pipeline +167 075 (27.5 %), parry +126 653 (20.8 %), `staged_island_solver` +35 845 (5.9 %), `.rodata` +31 036 (5.1 %).

Two gaps, from arithmetic on the figures above. The 2D groups sum to 511 854 bytes, so 11 676 bytes (2.2 %) are not attributed. The 3D groups sum to 544 340 bytes, so 63 533 bytes (10.5 %) are not attributed. The CI raw deltas are 524 827 (2D) and 626 158 (3D), from the table above. They differ from the local deltas. The difference is not reconciled.

**Why the soft-body code cannot be switched off.** Not verified by a build. Read from the sources:

- Rapier compiles `soft_body` once `alloc` is on (`rapier2d-0.36.1/src/dynamics/mod.rs:54-55`). It compiles `soft_constraint` unconditionally (`rapier2d-0.36.1/src/dynamics/solver/mod.rs:14`). `rapier3d-0.36.1` has the same lines (`rapier3d-0.36.1/src/dynamics/mod.rs:54-55`, `rapier3d-0.36.1/src/dynamics/solver/mod.rs:14`).
- `PhysicsPipeline::step` takes a `SoftBodySet`. GWEN owns one and never fills it. 2D: field at `crates/gwen-core/src/physics2d/world.rs:178`, built empty at `:230`, passed to `pipeline.step` at `:860` and `:870`. 3D: field at `crates/gwen-core/src/physics3d/world.rs:259`, built empty at `:699`, passed to `pipeline.step` at `:919`.
- `rapier2d-0.36.1/Cargo.toml:62` has a `block-solver` feature. No feature in `rapier2d-0.36.1/Cargo.toml` names the soft-body code (grep `soft`: only `[[test]]` targets, `:263-280`). The same grep on `rapier3d-0.36.1/Cargo.toml` also hits only `[[test]]` targets (`:384-409`).

## Levers tested

Measured in gzip by the same research agent, same date. Not re-run in this PR.

| lever | result | outcome |
| --- | --- | --- |
| `default-features = false` | already applied (`crates/gwen-core/Cargo.toml:18`, `:24`) | nothing to gain |
| `alloc` instead of `std` | -0.06 % in 2D | rejected: determinism not tested |
| `block-solver` | +0.68 % in 2D, +0.43 % in 3D | stays off: measured +0.68 % / +0.43 %, a cost with no measured gain (D-RAP-5, `DECISIONS-BINDING.md:32`, outside this repo) |
| `opt-level = "s"` | +18.4 % in 2D, +25.7 % in 3D | rejected, keep `z` |
| `opt-level = 3` | +33.2 % in 2D | rejected, keep `z` |
| `lto`, `strip`, `panic` | already tuned (`Cargo.toml:15`, `:17`, `:18`) | nothing to gain |
| avoid `wide` | impossible without a fork: Rapier requires `simba` with `wide` (`rapier2d-0.36.1/Cargo.toml:339-341`) | rejected |
| `wasm-opt -Oz --converge` | -0.3 %: 2D -1 346 bytes gzip, 3D -1 528 | possible later, see Follow-ups |

Not verified: the runtime performance of `block-solver` and of `--converge`. `--converge` was not tested in a browser.

## Consequences

- The three budgets are now 448993 (physics2d), 596489 (physics3d) and 706760 (physics3d-bvh) in gzip, and 356138, 461616 and 541995 in brotli.
- `light`, the three factories and `physics3d-fracture` are untouched. The `light` note "can be lowered" is out of scope here (`scripts/check-wasm-size.mjs:89`).
- The next real change is measured against the new baselines. While the job was red, a new rise did not show. With the new baselines, a rise above the budget fails the job again.
- A future Rapier release that drops the code is the way to lower the baselines again.
- `scripts/check-wasm-size.mjs` requires a non-empty `## WASM size budget` section in the PR body when a baseline is raised (`scripts/check-wasm-size.mjs:235`, `:242`, `:272`). This PR needs it.

## Allocation threshold (D-RAP-3)

The same upgrade adds one allocation per step. Rapier 0.36.1 builds one `Vec` of `PaddedCursor` values per step, one per worker, in `StageSync::new` (`crates/gwen-core/tests/physics_step_alloc.rs:99-105`). The threshold was 0 before `5c1d9fe6`: the line `assert_eq!(allocations, 0);` is at line 100 of `git show 5c1d9fe6~1:crates/gwen-core/tests/physics_step_alloc.rs`, and it was added with the test in commit `86f80f0c` (line 109 of `git show 86f80f0c:crates/gwen-core/tests/physics_step_alloc.rs`). It is a separate cost, recorded here because the same decision covers it.

The test comments say, quoted exactly (`crates/gwen-core/tests/physics_step_alloc.rs:114-116`, `crates/gwen-core/tests/physics3d_step_alloc.rs:113-115`):

> Maintainer figure (D-RAP-3), 2026-10-27: 15 ns malloc+free against 4.6 µs per step (about 0.3 %).
> Explicit maintainer override D-RAP-3. The threshold returns to 0 only from a measured
> run on a Rapier release without the allocation.

The threshold in the code today:

- The 2D test asserts `allocations <= 1` and `max_layout <= 64` after one warm-up step (`crates/gwen-core/tests/physics_step_alloc.rs:126-141`). The 3D test asserts the same (`crates/gwen-core/tests/physics3d_step_alloc.rs:125-140`).
- Debug builds ignore the test (`crates/gwen-core/tests/physics_step_alloc.rs:118-121`, `crates/gwen-core/tests/physics3d_step_alloc.rs:117-120`). The test runs only on a release build (`cargo test --release`).
- No CI job runs it in release. `.github/workflows/ci.yml:158-170` runs `cargo test -p gwen-core` with and without `--features physics2d` or `physics3d`, never with `--release`. No profile turns `debug_assertions` off for those runs (`Cargo.toml:13-27`). So in CI the test is always ignored, and CI does not enforce the threshold.
- The rule D-RAP-3 is: at most 1 allocation of 64 bytes per worker per step, release builds only (`DECISIONS-BINDING.md:32`, outside this repo). The code matches it. Without `parallel` there is one worker (`crates/gwen-core/tests/physics_step_alloc.rs:102-105`).

## Follow-ups

To open. This record creates no ticket.

- Ask upstream Rapier for a Cargo feature that removes the soft-body code. It is the largest cause (30 % of the growth).
- The profile matrix of #93. ADR 0003 is reserved for it.
- Evaluate `wasm-opt -Oz --converge` outside the Rapier lane, with a browser test.
- Add a CI job that runs the two allocation tests with `--release` (`physics_step_alloc` with `--features physics2d`, `physics3d_step_alloc` with `--features physics3d`), if the maintainer wants D-RAP-3 enforced.
