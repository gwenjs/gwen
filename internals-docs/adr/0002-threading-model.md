# ADR 0002 — Threading model

## Status

Accepted for v1.0.

Re-open only with a new ADR. That ADR must measure the `+atomics` build cost and list which of R1–R7 the change breaks.

`+atomics` build cost: not measured. Required to re-open.

## Machine

The benches print one header per variant. Both runs used the same CPU, OS, Node, and engine commit. `scripts/build-wasm.sh` rebuilt the wasm in this worktree before the run. `wasm-opt` was not on `PATH`, so the script skipped its optional `-Oz` pass. The binaries are `wasm-pack build --target web --release`.

`commit` is the engine revision the benches ran against (`9c34fb5`, `origin/v1-alpha`). This ADR was added after that run.

```
GWEN_FRAME_LOOP cpu="Apple M4 Max" os="Darwin 25.6.0 arm64" node="v24.7.0" commit=9c34fb5d3c81ed2f5c7b0420fea00231832f77f5 wasmScript=scripts/build-wasm.sh wasm-pack build --target web --release wasmArtifact=/Users/jonathan/packages/.worktrees/gwen-82-threading-adr/packages/core/wasm/light/gwen_core_bg.wasm wasmBytes=129085 wasmMtime=2026-10-05T12:10:39.320Z wasmRebuilt=true warmup=3 samples=11 maxEntities=65536 dt=0.016666666666666666 gridSpacing=2 boxHalf=0.4
```

```
GWEN_FRAME_LOOP cpu="Apple M4 Max" os="Darwin 25.6.0 arm64" node="v24.7.0" commit=9c34fb5d3c81ed2f5c7b0420fea00231832f77f5 wasmScript=scripts/build-wasm.sh wasm-pack build --target web --release wasmArtifact=/Users/jonathan/packages/.worktrees/gwen-82-threading-adr/packages/core/wasm/physics2d/gwen_core_bg.wasm wasmBytes=577749 wasmMtime=2026-10-05T12:10:53.001Z wasmRebuilt=true warmup=3 samples=11 maxEntities=65536 dt=0.016666666666666666 gridSpacing=2 boxHalf=0.4
```

## Decision

v1.0 keeps the simulation on the main thread. Option A.

A new bulk API does not have to be worker-safe in 1.0. It must follow R1–R7.

B and C stay rejected. The numbers below are the ceiling, not a plan to build them.

## Scene

Both benches share `packages/core/bench/frame-loop-scene.ts`.

- N is 1 000, 10 000, and 50 000. `maxEntities` is 65 536.
- Each sample is one `advance(1/60)` after 3 warmup frames. The median is over 11 samples.
- Each N has a transform in the wasm instance and a TypeScript entity with `Position` and `Velocity`. Index modulo 4 adds `Health`, `Enemy`, or both, so there are four component archetypes.
- One `defineSystem` updates that query in `onUpdate`. `onRender` reads world x, y, and rotation for the N transform slots.
- The physics2d bench adds N dynamic bodies with box colliders (half-extent 0.4) on a grid of spacing 2. Gravity is -9.81. The plugin steps from `engine:before-update`.
- `debug: true` is the primary table. `debug: false` is a second `total` only.
- Engines are stopped in `finally`.

This tree does not have `QueryChunk` (#65) or #74's `STORAGE_REFERENCE_SCENE`. The update loop uses today's `useQuery` accessor. `createRealEngine` takes no `debug` flag, so the bench sets `engine.debug` before sampling.

`EngineFramePhaseMs.physics` is not in the table. The built-in step is a no-op. Rapier runs inside `engine:before-update`, which is the `plugins` column. #109 removes the `physics` key.

## Medians (debug true)

Milliseconds per frame, pasted from the bench lines.

| variant | N | tick | plugins | wasm | update | render | afterTick | total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| light | 1000 | 0.0005 | 0.0002 | 0.0002 | 0.2210 | 0.1772 | 0.0003 | 0.4059 |
| light | 10000 | 0.0011 | 0.0004 | 0.0003 | 2.0937 | 1.3484 | 0.0007 | 3.4595 |
| light | 50000 | 0.0008 | 0.0003 | 0.0006 | 9.8155 | 7.1821 | 0.0007 | 16.9708 |
| physics2d | 1000 | 0.0004 | 1.2601 | 0.0002 | 0.2251 | 0.1782 | 0.0002 | 1.6719 |
| physics2d | 10000 | 0.0010 | 10.2687 | 0.0012 | 2.3337 | 1.4210 | 0.0008 | 14.1788 |
| physics2d | 50000 | 0.0015 | 52.9572 | 0.0017 | 13.7967 | 10.1619 | 0.0013 | 76.4414 |

Source lines:

```
GWEN_FRAME_LOOP variant=light debug=true N=1000 tick=0.0005 plugins=0.0002 wasm=0.0002 update=0.2210 render=0.1772 afterTick=0.0003 total=0.4059 renderSink=61064
GWEN_FRAME_LOOP variant=light debug=true N=10000 tick=0.0011 plugins=0.0004 wasm=0.0003 update=2.0937 render=1.3484 afterTick=0.0007 total=3.4595 renderSink=1980000
GWEN_FRAME_LOOP variant=light debug=true N=50000 tick=0.0008 plugins=0.0003 wasm=0.0006 update=9.8155 render=7.1821 afterTick=0.0007 total=16.9708 renderSink=22252304
GWEN_FRAME_LOOP variant=physics2d debug=true N=1000 tick=0.0004 plugins=1.2601 wasm=0.0002 update=0.2251 render=0.1782 afterTick=0.0002 total=1.6719 renderSink=61064
GWEN_FRAME_LOOP variant=physics2d debug=true N=10000 tick=0.0010 plugins=10.2687 wasm=0.0012 update=2.3337 render=1.4210 afterTick=0.0008 total=14.1788 renderSink=1980000
GWEN_FRAME_LOOP variant=physics2d debug=true N=50000 tick=0.0015 plugins=52.9572 wasm=0.0017 update=13.7967 render=10.1619 afterTick=0.0013 total=76.4414 renderSink=22252304
```

## Second total (debug false)

| variant | N | total |
| --- | ---: | ---: |
| light | 1000 | 0.2978 |
| light | 10000 | 2.9990 |
| light | 50000 | 16.8287 |
| physics2d | 1000 | 1.3435 |
| physics2d | 10000 | 17.0025 |
| physics2d | 50000 | 70.5273 |

```
GWEN_FRAME_LOOP variant=light debug=false N=1000 tick=0.0002 plugins=0.0002 wasm=0.0001 update=0.1722 render=0.1241 afterTick=0.0002 total=0.2978 renderSink=61064
GWEN_FRAME_LOOP variant=light debug=false N=10000 tick=0.0003 plugins=0.0002 wasm=0.0001 update=1.7408 render=1.2630 afterTick=0.0002 total=2.9990 renderSink=1980000
GWEN_FRAME_LOOP variant=light debug=false N=50000 tick=0.0007 plugins=0.0003 wasm=0.0008 update=9.6724 render=7.1932 afterTick=0.0007 total=16.8287 renderSink=22252304
GWEN_FRAME_LOOP variant=physics2d debug=false N=1000 tick=0.0004 plugins=0.9852 wasm=0.0003 update=0.2185 render=0.1306 afterTick=0.0004 total=1.3435 renderSink=61064
GWEN_FRAME_LOOP variant=physics2d debug=false N=10000 tick=0.0011 plugins=11.1662 wasm=0.0015 update=2.5012 render=1.6923 afterTick=0.0011 total=17.0025 renderSink=1980000
GWEN_FRAME_LOOP variant=physics2d debug=false N=50000 tick=0.0009 plugins=50.8970 wasm=0.0016 update=11.7189 render=7.6274 afterTick=0.0007 total=70.5273 renderSink=22252304
```

## Derived ceilings

Subtraction uses the debug-true medians above. Copy rows are pasted, not derived.

B gain ceiling = `plugins(physics2d) − plugins(light)` at the same N.

| N | plugins physics2d | plugins light | ceiling |
| ---: | ---: | ---: | ---: |
| 1000 | 1.2601 | 0.0002 | 1.2599 |
| 10000 | 10.2687 | 0.0004 | 10.2683 |
| 50000 | 52.9572 | 0.0003 | 52.9569 |

C gain ceiling = `total − render`.

| variant | N | total | render | ceiling |
| --- | ---: | ---: | ---: | ---: |
| light | 1000 | 0.4059 | 0.1772 | 0.2287 |
| light | 10000 | 3.4595 | 1.3484 | 2.1111 |
| light | 50000 | 16.9708 | 7.1821 | 9.7887 |
| physics2d | 1000 | 1.6719 | 0.1782 | 1.4937 |
| physics2d | 10000 | 14.1788 | 1.4210 | 12.7578 |
| physics2d | 50000 | 76.4414 | 10.1619 | 66.2795 |

Copy floor. One `Uint8Array.prototype.set` of N×32 bytes, then of 2×N×32 bytes.

```
GWEN_FRAME_LOOP copy N=1000 bytes=32000 medianMs=0.0006 sink=0
GWEN_FRAME_LOOP copy N=1000 bytes=64000 medianMs=0.0008 sink=0
GWEN_FRAME_LOOP copy N=10000 bytes=320000 medianMs=0.0041 sink=0
GWEN_FRAME_LOOP copy N=10000 bytes=640000 medianMs=0.0077 sink=0
GWEN_FRAME_LOOP copy N=50000 bytes=1600000 medianMs=0.0188 sink=0
GWEN_FRAME_LOOP copy N=50000 bytes=3200000 medianMs=0.0378 sink=0
```

At 50 000 entities the physics step is about 53 ms and the copy of one transform pair is about 0.04 ms. Moving physics off the main thread can hide at most the B ceiling. It cannot hide `update` or `render`. A full worker (C) still has to pay the render read, and any shared-memory design is unmeasured.

## Options

| | A. Main thread | B. Physics in a worker | C. Simulation in a worker |
| --- | --- | --- | --- |
| Composables | Stay synchronous. | `getPosition` and character `move()` lose a same-frame result. | `useQuery` views are not readable from the main thread without a SAB. |
| Plugins | DOM services stay as they are. | Poses are copied back each step. | DOM plugins cannot move. Input gains a frame of latency. |
| Errors | `emit` stays on the frame stack. | Physics traps leave `_runFrame`. | Payloads must be structured-cloneable. |
| Memory growth | Detach detection stays valid. | `postMessage` leaves the main heap unshared. A SAB does not detach. | Shared memory needs a declared maximum. |
| Measured ceiling | The whole frame is one core. At N=50 000, light total is 16.9708 ms and physics2d total is 76.4414 ms. | At most 52.9569 ms at N=50 000. Copy floor is 0.0378 ms for 2×N×32. | At most 66.2795 ms at N=50 000 (physics2d total minus render). |
| Baseline | No cross-origin isolation. | No COOP/COEP if the copy uses `postMessage`. | SAB needs COOP and COEP. |

A is the v1.0 model because the contracts already chosen are synchronous and same-thread. B and C rewrite physics, DOM plugins, and the error path. Nothing threaded exists to keep. The SAB and COOP/COEP surface is unused by shipped plugins and is removed in #115, not here.

## Rules

R1. The simulation-to-presentation seam is `engine:render` plus `engine.frame`. Render code reads `engine.frame.transforms2D`, `readInterpolatedTransform2D`, or `useTransform().world` during render. It does not read `useQuery` chunks, `engine.memory` views, or wasm exports.

R2. Community wasm modules read transforms only through the #108 `transformRegion` copy. They do not receive an address in core memory.

R3. Bulk APIs are simulation-side. Arrays from a query or a memory view are valid only inside the synchronous block of a system, an actor, or a simulation hook (`engine:tick` through `engine:after-update`). No public API hands those arrays to presentation code.

R4. Input reaches the simulation only through plugin services sampled in `engine:tick`. Official composables do not read `window` or `document` during simulation phases.

R5. Error payloads stay plain data. New core emitters put only strings, numbers, and ids in `EngineErrorPayload.context`. No functions and no DOM nodes.

R6. Physics has one step site. Each physics plugin steps Rapier only from its `engine:before-update` handler. There is no second site and no user-callable step.

R7. No new `SharedArrayBuffer`, `Atomics`, `crossOriginIsolated`, or shared `WebAssembly.Memory`. COOP and COEP stay optional everywhere.

## Re-opening

A later ADR may leave A only if it measures the `+atomics` build cost and names which of R1–R7 break.

## Not in this change

This record does not remove `requireSAB`, `detectSharedMemoryRequired`, `wasm.sharedMemory`, the contact ring buffers, or the default COOP/COEP headers. That cleanup is #115.

The SAB sentences in the published docs and in `internals-docs/architecture.md` stay until #62.

The guard test allow-list is today's offenders and may only shrink: the vite header sites, `wasm-bridge.ts`, both contact ring buffers, and `packages/physics3d/src/plugin/bvh.ts`.

CI does not collect `packages/core/bench/` until #57. The physics2d bench is collected. The medians above are the local run, not the CI trend.
