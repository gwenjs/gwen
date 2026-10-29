# ADR 0004 — Trust model

Contributor note. Not an end-user guide.

## Status

Proposed. 2026-10-21. Owner: Jonathan Moutier.

ADR 0003 is not used by this record. This record keeps the number 0004, as #269 asks.

Supersedes no ADR. Re-open with a new ADR when a new input channel is added or a trust level changes.

## Context

GWEN runs a Rust/WASM core driven by TypeScript. The same core is meant to serve a game and an authoritative server.

`InitWasmOptions` accepts `maxEntities`, `jsUrl`, and `wasmUrl` (`packages/core/src/engine/wasm-bridge-types.ts:1074-1081`).
It has no `wasmBytes` field and no `wasmModule` field.
On Node, `createEngine` checks that `gwen_core.js` exists (`packages/core/src/engine/engine-factory.ts:44`) and passes a `file:` URL (`:48`). It reads only the `.wasm` file (`:46`) and passes a `data:` URL (`:49`).
`@gwenjs/core` has no `./node` export (`packages/core/package.json:15-88`).

Community modules load through `loadWasmModule`.
The core glue loads with `import()` (`packages/core/src/engine/wasm-bridge.ts:142-179`).
The bridge does not build a script from that URL (`packages/core/src/engine/wasm-bridge.ts:127-132`).

The build writes `gwen_core_factory.js` next to each browser variant (`scripts/build-wasm.sh:202`).
The running bridge still loads `gwen_core.js` (`packages/core/src/engine/wasm-bridge.ts:320-323`).

No earlier document states what the engine trusts, what it checks, and what the host must do.

## Decision drivers

- A server sees client bytes that a local game does not.
- One WASM instance has its own linear memory. The JS thread has no preemption.
- The engine cannot sandbox JavaScript it is handed. `packages/core/src` has no `worker_threads`.
- Each later security ticket should own one row of the table below.

## Decision

### Trusted input

1. Host configuration is trusted.
   That is `jsUrl`, `wasmUrl`, `cratePath`, and the Vite options.
   The engine does not sanitise them.
   The glue URL is resolved with `new URL` and loaded with `import()` (`packages/core/src/engine/wasm-bridge.ts:152-167`).
   A URL that does not parse, or an `import()` that rejects, throws `CORE:WASM_LOAD_ERROR` (`packages/core/src/engine/wasm-bridge.ts:157-177`).
   The loaded module must expose `default` or `initSync`, and a constructor `Engine` (`packages/core/src/engine/wasm-bridge.ts:364-382`).
   A missing piece is `CORE:WASM_LOAD_ERROR`.

2. The core binary is trusted.
   The developer chooses it.
   Today it arrives as `wasmUrl`, including a `data:` URL.
   The engine does not check provenance.
   A non-OK fetch is `CORE:WASM_LOAD_ERROR` (`packages/core/src/engine/wasm-bridge.ts:344-349`).
   A fetch aborted after 10 seconds is `CORE:WASM_TIMEOUT` (`packages/core/src/engine/wasm-bridge.ts:336-357`).
   A `data:` payload is decoded in `bytesFromDataUrl` (`packages/core/src/engine/wasm-module-cache.ts:18-34`, called at `packages/core/src/engine/wasm-bridge.ts:332`).
   The `initSync` fallback fetches `wasmUrl` again with no status check and no 10 s abort (`packages/core/src/engine/wasm-bridge.ts:367-369`).
   A failure that is not a `GwenError` is wrapped as `CORE:WASM_LOAD_ERROR` (`packages/core/src/engine/wasm-bridge.ts:398-412`).
   A trap in the `Engine` constructor is `CORE:WASM_PANIC` (`packages/core/src/engine/wasm-bridge.ts:385-389`).
   `CORE:WASM_GLUE_MISMATCH` is planned in #260.
   It is not in `CoreErrorCodes` (`packages/core/src/engine/engine-errors.ts:58-117`).
   A search of `packages/schema/src` found no such code.

3. JavaScript plugins are trusted. `engine.use` and config modules run with the caller's authority. The engine does not contain them.

### Checked input

4. The generated factory is `gwen_core_factory.js`, one file per browser variant.
   `scripts/build-wasm.sh:199` stamps `gwen.build` after `optimize_wasm`.
   `scripts/build-wasm.sh:202` runs `scripts/wasm-factory.mjs`.
   The package exports `./wasm/<variant>/factory` for `light`, `physics2d`, and `physics3d` (`packages/core/package.json:69-88`).
   `readRequiredSection` reads `gwen.build` and `gwen.fingerprint` (`scripts/wasm-factory.mjs:405-414`).
   Each section must appear once. Any other count throws.
   The build id is read at `scripts/wasm-factory.mjs:430` and passed at `:436`. It is stored on `CONTRACT.buildId` at `:355`.
   The fingerprint is read at `:431` and passed at `:437`. It is stored on `CONTRACT.fingerprint` at `:356`.
   The generated header names wasm-bindgen and `MIT OR Apache-2.0` (`scripts/wasm-factory.mjs:367`).
   `packages/core/src` does not read `CONTRACT`, `createGlue`, or `gwen_core_factory`.
   The fingerprint check is planned in #260.
   It does not exist yet.

5. A community WASM module is semi-trusted.
   Its memory is its own.
   The import object passed to `WebAssembly.instantiate` is `{ gwen: gwenImports }` (`packages/core/src/engine/wasm-module-runner.ts:111` and `:130`).
   Those four functions are `transform_buffer_ptr`, `transform_stride`, `max_entities`, and `abi_version` (`packages/core/src/engine/wasm-module-runner.ts:84-89`).
   No engine, DOM, or foreign memory is in that object.
   The engine checks:
   - Fetch, then `arrayBuffer`, then `WebAssembly.compile` (`packages/core/src/engine/wasm-module-runner.ts:94-104`).
     A failed fetch is `CORE:WASM_LOAD_ERROR`.
     There is no byte cap before compile.
   - ABI, before region use.
     `checkPluginApiVersion` runs on the probe (`packages/core/src/engine/wasm-module-runner.ts:113`) and on the real instance (`packages/core/src/engine/wasm-module-runner.ts:141`).
     The function is `packages/core/src/engine/engine-types.ts:96-105`.
     A missing export, a non-function, or a number other than `GWEN_PLUGIN_API_VERSION` (`2_001_000`, `packages/core/src/engine/engine-types.ts:87`) throws `GwenWasmAbiError` with code `CORE:WASM_MODULE_ABI_MISMATCH`.
     The module is not registered.
   - Declared regions (`packages/core/src/engine/wasm-module-runner.ts:306-375`).
     An unknown region name is `CORE:WASM_MODULE_REGION_INVALID`.
     A region shorter than `maxEntities * TRANSFORM_STRIDE` is `CORE:WASM_MODULE_REGION_TOO_SMALL` (`:317-322`).
     A non-zero offset that is not a positive multiple of 4 is invalid (`:324-329` and `:357-362`).
     The resolved end must sit inside the exported memory (`:367-373`).
     The probe offset must equal the instance offset (`:151-157`).
     A channel declared without an exported memory is `CORE:WASM_MODULE_NO_MEMORY` (`:167-176`).
   - Traps in `stepAll` (`packages/core/src/engine/wasm-module-runner.ts:242-279`).
     A `RuntimeError` or `GwenWasmPanicError` gives `CORE:WASM_PANIC`.
     Any other throw gives `CORE:FRAME_LOOP_ERROR` (`packages/core/src/engine/wasm-module-runner.ts:269-275`).
     The next module still runs.
     A fill trap returns from `stepAll`.

6. Component data is semi-trusted.
   `fillScratch` walks `Object.keys(def.schema)` only (`packages/core/src/engine/engine-entities.ts:1024-1038`).
   The scratch record is a plain object created for that layout (`packages/core/src/engine/engine-entities.ts:1018`).
   `writeCold` serializes that scratch at fixed field offsets through a `DataView` (`packages/core/src/engine/engine-entities.ts:746-749`, `packages/core/src/schema.ts:338-345`).
   An in-place update uses `patch`, which writes only keys the caller owns (`packages/core/src/schema.ts:355-364`).
   A key that is not in the schema is not read on this path.

### Host duty

7. Memory isolation per engine is `wasmInstance: "isolated"` (`packages/core/src/engine/wasm-bridge.ts:358`).
   CPU containment with workers is planned in #268.
   Workers are not an option in this tree.
   `packages/core/src` has no `worker_threads`.
   `engine.isolated()` is the list of error targets already skipped (`packages/core/src/engine/engine-types.ts:516-520`, `packages/core/src/engine/gwen-engine.ts:82-84`).
   It is not an instance mode.
   A non-returning call still runs on the caller's thread.
   The host owns that boundary.

8. `jsUrl`, `wasmUrl`, and a JS plugin stay trusted config (decisions 1 and 3). The host must not take them from an untrusted client.

9. The host bounds how many engines it creates, and how many WASM instances the process may hold.
   The engine checks `maxEntities` as an integer from 1 to 2_000_000 (`packages/core/src/engine/engine-config-validator.ts:38-52`).
   A value above 500_000 warns and is still accepted (`:54-58`).
   The engine has no engine-count cap.
   Browser ceilings are a host responsibility. When `glue.initSync` throws a `RangeError` or a value that is not an `Error`, `initWasm` throws `CORE:WASM_CAPACITY_EXHAUSTED` (`packages/core/src/engine/wasm-instance-provider.ts:46`). Browser `isolated` is not supported until #265.
   The Node capacity gate is planned in #264.

## Consequences

- This ADR owns the boundary table. Each row names the trust level, the check that exists today, and the owner.
- The glue loads with `import()` only (`packages/core/src/engine/wasm-bridge.ts:167`).
  The loader does not interpolate the URL into source and does not build a blob script (`packages/core/src/engine/wasm-bridge.ts:127-132`).
  That loader change is #262, "Load the glue without building module source".
  It landed in #290.
  This ADR does not change the loader.
- A glue/binary mismatch code is planned in #260, "Stamp the core binary with a build id and an ABI fingerprint, and reject a glue/binary mismatch".
  The code is `CORE:WASM_GLUE_MISMATCH`.
  It is not in the tree.
- A byte cap before `WebAssembly.compile`, and the host rules for `memory.grow` and a non-returning call, are planned in #270, "Cap community WASM module size and document runtime limits".
  This ADR does not fix #260 or #270.
- `SECURITY.md` links here.

## Not shipped

These names appear above so a later ticket can cite them. #263's instance mode is engine behaviour (`packages/core/src/engine/wasm-bridge.ts:358`). The rest is not.

- #259 — the factory generator and the package export are in this tree.
  The notices file is not. #259 decided that `packages/core/THIRD-PARTY-NOTICES` will list wasm-bindgen under the Apache-2.0 option of `MIT OR Apache-2.0`.
  `git ls-files` and a root listing found no `THIRD-PARTY-NOTICES` file.
  `packages/core/package.json` `files` lists `dist`, `wasm`, `!wasm/toolchain.json`, and `LICENSE` (`:6-11`).
- #260 — fingerprint compare and `CORE:WASM_GLUE_MISMATCH`. Planned.
- #263 — `wasmInstance` `"shared"` (default) or `"isolated"` (one instance per engine) is in the tree (`packages/core/src/engine/wasm-bridge.ts:358`, `packages/core/src/engine/wasm-instance-provider.ts:128`). `createEngine` in Node still defaults to `shared` (`packages/core/src/engine/engine-factory.ts:79`). Browser `isolated` is not supported until #265. The browser capacity limit is not in this tree. The issue is "Add a WASM instance provider: shared or isolated instances".
- #264 — Node capacity gate on Linux. Planned. The issue is "Gate WASM instance capacity in CI on Linux x64 and arm64".
- #268 — workers for CPU containment. Planned. The issue is "Document and test a multi-room server on `worker_threads`".
- #270 — community module byte cap. Planned.
- #89 — start from bytes or a compiled module. Still open. The options are not on `InitWasmOptions`.

## Order of checks

Core binary, as the bridge does it today.

1. Resolve `jsUrl` and `wasmUrl`. When neither `jsUrl` nor the package path resolves, init throws `CORE:WASM_LOAD_ERROR` (`packages/core/src/engine/wasm-bridge.ts:320-331`).
2. `import()` the glue URL (`packages/core/src/engine/wasm-bridge.ts:167`).
   The function comment says this one path is for the main thread, a worker, and Node (`packages/core/src/engine/wasm-bridge.ts:127-132`).
   That is the loader.
   It is not the room-worker recipe planned in #268.
   The loaded module is cached on `globalThis` under a key derived from the URL (`:143-147`).
3. Fetch `wasmUrl` with a 10 second abort, or decode a `data:` URL (`packages/core/src/engine/wasm-bridge.ts:336-361`).
   `bytesFromDataUrl` rejects a payload with no comma (`packages/core/src/engine/wasm-module-cache.ts:19-24`).
   A `;base64` payload is decoded with `atob`.
   Any other payload is `decodeURIComponent` then UTF-8 (`packages/core/src/engine/wasm-module-cache.ts:27-29`).
4. Call `glue.default({ module_or_path })` or `glue.initSync`.
   Require `glue.Engine`.
   Construct `new glue.Engine(maxEntities)` (`packages/core/src/engine/wasm-bridge.ts:364-389`).
5. There is no compare of a fingerprint or a build id. That check is planned in #260.

Community module, inside `WasmModuleRunner.load`.

1. `load` calls `assertState("loadWasmModule")` before the fetch (`packages/core/src/engine/wasm-module-runner.ts:71`). The class comment says the facade passes `_assertNotFaulted` (`packages/core/src/engine/wasm-module-runner.ts:17-18`).
   A name already loaded returns the existing handle (`:72-75`).
2. Build the four `{gwen}` functions (`:79-89`).
3. Fetch the URL and compile the bytes (`:94-104`). No length check.
4. When a transform region is declared and the module exports `gwen_<region>_ptr`, instantiate a probe and check the ABI before reading the offset (`:105-114`).
5. Instantiate the real instance with the same import object (`:128-130`).
   Check the ABI again, outside both instantiate `catch` blocks, so `GwenWasmAbiError` is not wrapped as `CORE:WASM_LOAD_ERROR` (`:139-141`).
6. Resolve the region, compare the probe offset, and reject a region that is not a positive multiple of 4 or that ends past memory (`:149-159`, `:351-374`).
7. Build channel views only when the module exports memory (`:167-178`).
8. On a later frame, `stepAll` skips a module whose id `wasm:<name>` is already on the error-target list (`:262-263`).
   A throwing step is reported.
   The loop continues (`:241`, `:267-277`).

## Boundary table

| #   | Channel                                                           | Who           | Trust              | What the engine validates today                                                                                                                                                                                                                                                                                                 | Owner                                                                           |
| --- | ----------------------------------------------------------------- | ------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | `jsUrl` glue URL                                                  | host config   | trusted            | `import()` of the absolute URL (`wasm-bridge.ts:167`). A bad URL or a rejected import is `CORE:WASM_LOAD_ERROR` (`wasm-bridge.ts:157-177`). The module must expose `default` or `initSync`, and `Engine` (`wasm-bridge.ts:364-382`). No source is built from the URL.                                                           | host; loader change is #262                                                     |
| 2   | `wasmUrl`, including a `data:` URL                                | host config   | trusted            | HTTP status (`wasm-bridge.ts:344-349`), a 10 s abort mapped to `CORE:WASM_TIMEOUT` (`wasm-bridge.ts:336-357`), and `data:` decode (`wasm-bridge.ts:111-125`, used at `:341-342`). The `initSync` fallback fetches again with no status check and no 10 s abort (`wasm-bridge.ts:367-369`).                                           | host                                                                            |
| 3   | core binary (bytes or a compiled module)                          | host / caller | trusted            | Today the option is `wasmUrl` only (`wasm-bridge-types.ts:1074-1081`). There is no `wasmBytes` or `wasmModule` field. A failure that is not a `GwenError` is wrapped as `CORE:WASM_LOAD_ERROR` (`wasm-bridge.ts:398-412`). A trap in the `Engine` constructor is `CORE:WASM_PANIC` (`wasm-bridge.ts:385-389`). `CORE:WASM_GLUE_MISMATCH` is absent from `CoreErrorCodes` (`engine-errors.ts:58-117`) and from `packages/schema/src`. Planned in #260. | host; mismatch check planned in #260; bytes or module option is #89, still open |
| 4   | generated factory `gwen_core_factory.js`, one per browser variant | build         | trusted            | `scripts/build-wasm.sh:199` stamps `gwen.build`. `scripts/build-wasm.sh:202` writes the factory via `scripts/wasm-factory.mjs`. `readRequiredSection` requires one `gwen.build` and one `gwen.fingerprint` (`scripts/wasm-factory.mjs:405-414`). Those strings are read at `:430` and `:431`, passed at `:436` and `:437`, and stored on `CONTRACT.buildId` and `CONTRACT.fingerprint` at `:355-356`. Exported at `packages/core/package.json:69-88`. The engine source does not compare them. The runtime check is planned in #260. | #259 for the generator; check planned in #260                                   |
| 5   | community WASM via `loadWasmModule`                               | third party   | semi-trusted       | Fetch and compile (`wasm-module-runner.ts:94-104`). ABI at `:113` and `:141`. Regions at `:306-375`, plus probe offset at `:151-157`. Traps in `stepAll` at `:242-279`. No byte cap, no `memory.grow` cap, no call timeout. Those limits are planned in #270.                                                                   | engine for ABI, regions, and traps (#92); caps planned in #270                  |
| 6   | `{gwen}` imports handed to a module                               | engine        | engine-built       | Four numeric functions only (`wasm-module-runner.ts:84-89`). The instantiate object is `{ gwen: gwenImports }` (`:111`, `:130`).                                                                                                                                                                                                | #92                                                                             |
| 7   | JS plugin `use()` / config modules                                | host          | trusted            | None. Plugin JS runs on the caller thread. No `worker_threads` in `packages/core/src`.                                                                                                                                                                                                                                          | host; CPU containment planned in #268                                           |
| 8   | component / entity data, including bytes from the wire            | app / client  | semi-trusted       | Schema keys only (`engine-entities.ts:1024-1038`). Fixed-offset `DataView` writes (`engine-entities.ts:746-749`, `packages/core/src/schema.ts:338-345`). `patch` uses own keys (`packages/core/src/schema.ts:355-364`).                                                                                                         | this ADR                                                                        |
| 9   | scene / layout / asset paths                                      | app           | trusted            | Not audited. This record claims no engine check.                                                                                                                                                                                                                                                                                | host                                                                            |
| 10  | dev middleware under `/wasm` (default `wasmPublicPath`)           | dev request   | semi-trusted       | `resolveWasmFileWithin` decodes the name, allows only `.wasm` and `.js`, and requires `startsWith(base + sep)` (`packages/vite/src/index.ts:114-134`). Default `wasmPublicPath` is `"/wasm"` (`:176`). Called at `:594`, and through `findWasmPluginFile` (`:149`, used at `:605`). An escaping path returns null.            | Vite plugin                                                                     |
| 11  | Vite HMR / reload messages                                        | dev server    | trusted (dev only) | Scene changes and `.wasm` changes send `{ type: "full-reload" }` and no evaluated payload (`packages/vite/src/index.ts:565-571`, `packages/vite/src/plugins/wasm.ts:97-101`).                                                                                                                                                   | Vite plugin                                                                     |
| 12  | licence / provenance of the generated factory                     | build         | trusted            | The generated header names wasm-bindgen and `MIT OR Apache-2.0` (`scripts/wasm-factory.mjs:367`). No `THIRD-PARTY-NOTICES` file is in the repo. #259 decided that `packages/core/THIRD-PARTY-NOTICES` will list wasm-bindgen under the Apache-2.0 option. That file is planned.                                                 | #259                                                                            |

Paths in the table are under `packages/core/src/engine/` unless the cell names another directory.

## Acceptance

These lines match tests in this tree. Nothing else in this ADR is claimed as a test.

- A module with no `gwen_plugin_api_version` rejects with `CORE:WASM_MODULE_ABI_MISMATCH` and `actual: null`.
  `packages/core/tests/integration-wasm/plugin-abi.test.ts`, "rejects a module with no version export and sets actual to null".
- A region that fails the load check rejects with `CORE:WASM_MODULE_REGION_INVALID`, and the engine is not `faulted`.
  `packages/core/tests/integration-wasm/module-transform-region.test.ts`, "rejects each invalid region at load and keeps the engine running".
- The glue loader source contains no `new Blob(`, no `createElement("script")`, and no `createObjectURL`.
  `packages/core/tests/engine/glue-loader.test.ts`, "source builds no module source".
- A `/wasm` request that leaves the wasm directory returns no body.
  `packages/vite/tests/vite-plugin.test.ts`, "gwen() WASM middleware — path traversal containment", including "rejects `..` traversal to a .wasm file outside the wasm directory".

No test in this record covers `CORE:WASM_GLUE_MISMATCH`, a module byte cap, workers, or a `THIRD-PARTY-NOTICES` file.
Isolated instances are covered by `packages/core/tests/integration-wasm/instance-provider.test.ts` and `packages/core/tests/engine/instance-capacity.test.ts`.
The rest are planned in #260, #270, #268, and #259.
