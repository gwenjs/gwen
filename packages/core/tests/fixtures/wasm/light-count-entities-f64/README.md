# light `count_entities` f64 fixture

Throwaway build input. Do not apply this patch to the sources. Apply it on a checkout of the base, build, copy the binary, restore the file, then build again.

The patch hunk is `@@ -204,8 +204,8 @@` in `packages/core/tests/fixtures/wasm/light-count-entities-f64/count-entities-f64.patch:5`. It changes `count_entities` from `u32` to `f64`. On this branch the function is `crates/gwen-core/src/bindings.rs:207`.

```sh
git apply packages/core/tests/fixtures/wasm/light-count-entities-f64/count-entities-f64.patch
GWEN_SKIP_WASM_OPT=1 ./scripts/build-wasm.sh
cp packages/core/wasm/light/gwen_core_bg.wasm packages/core/tests/fixtures/wasm/light-count-entities-f64/gwen_core_bg.wasm
git checkout -- crates/gwen-core/src/bindings.rs
GWEN_SKIP_WASM_OPT=1 ./scripts/build-wasm.sh
```

`wasm-opt` is skipped when `GWEN_SKIP_WASM_OPT=1` (`scripts/build-wasm.sh:95`). The pin file records rustc `1.99.0` and wasm-pack `0.13.1` (`wasm-size.json:4` and `wasm-size.json:5`). This note was written with Node `v24.7.0` (`node --version`).

Read both build ids from the files. The test never copies an id by hand (`packages/core/tests/integration-wasm/glue-mismatch.test.ts:223`). It relies only on the same export names (`packages/core/tests/integration-wasm/glue-mismatch.test.ts:216`), the same fingerprint (`crates/gwen-core/src/fingerprint.rs:104`), and a different `gwen.build` (`packages/core/tests/integration-wasm/glue-mismatch.test.ts:224`).

```sh
node --input-type=module -e '
import { readFileSync } from "node:fs";
function buildId(path) {
  const file = readFileSync(path);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  const module = new WebAssembly.Module(bytes);
  const text = new TextDecoder().decode(WebAssembly.Module.customSections(module, "gwen.build")[0]);
  const fingerprint = new TextDecoder().decode(WebAssembly.Module.customSections(module, "gwen.fingerprint")[0]);
  console.log(path, bytes.byteLength, text, fingerprint);
}
buildId("packages/core/tests/fixtures/wasm/light-count-entities-f64/gwen_core_bg.wasm");
buildId("packages/core/wasm/light/gwen_core_bg.wasm");
'
```

Example output of that command on this tree. It reproduces only with the same `CARGO_HOME` path and the same toolchain. wasm-bindgen `0.2.117` (`./Cargo.lock:1383`) embeds its registry path in both binaries, and `gwen.build` is the sha256 of the bytes before the section (`scripts/wasm-build-id.mjs:5`), so both ids are machine-path dependent.

- fixture, 96114 bytes: `gwen.build` `983996521953de7da01a853abadebd66e5f6e6ad29489d4a9debb0bc45eef2b8`, fingerprint `gwen-core;variant=light;abi=1;profile=release`
- shipped light, 96109 bytes: `gwen.build` `81b30e74311005fce72fdf7ac73155c33be75f6349774f93f3068990af9e05ff`, fingerprint `gwen-core;variant=light;abi=1;profile=release`
