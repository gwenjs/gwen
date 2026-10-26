import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PREFIXES =
  "CORE KIT SCHEMA APP VITE MATH PHYSICS2D PHYSICS3D RENDERER CAMERA CONFORMANCE AUDIO ASSETS RENDERER_THREE INSPECTOR".split(
    " ",
  );
const ANCHORS =
  "app-plugin-requirement-missing app-plugin-requirement-order app-service-provider-missing core-actor-circular-ownership core-actor-no-live-instance core-actor-plugin-not-ready core-introspection-page-invalid core-invalid-chunk-size core-invalid-entity-id core-layout-dispose-failed core-layout-handle-not-spawned core-layout-load-failed core-outside-actor-context core-outside-cleanup-context core-outside-engine-context core-outside-layout-context core-outside-scene-context core-outside-system-context core-plugin-extension-api-mismatch kit-module-invalid kit-plugin-setup-failed renderer-foreign-layer-manager schema-invalid-config schema-modules-required camera-empty-path camera-perspective-fallback camera-priority-conflict camera-viewport-not-found renderer-already-registered renderer-conformance-failed renderer-contract-version renderer-layer-order-conflict renderer-missing-layer renderer-screen-resize-observer-not-available renderer-screen-to-world-perspective renderer-screen-viewport-not-found renderer-surface-invalid renderer-unavailable-camera renderer-unknown-layer core-actor-pool-exhausted core-invalid-component-schema core-invalid-component-type core-invalid-scene-route app-config-load-failed app-module-load-failed app-module-setup-failed vite-wasm-not-found vite-optimizer-unknown-component vite-optimizer-unknown-field math-invalid-hex-color core-frame-loop-error core-plugin-setup-error core-plugin-runtime-error core-wasm-load-error core-wasm-timeout core-wasm-panic core-query-capacity-exceeded core-entity-limit-reached core-component-type-limit-reached core-invalid-parent core-invalid-max-entities core-buffer-length-mismatch core-wasm-module-region-too-small core-wasm-module-region-invalid core-invalid-shared-buffer core-component-write-rejected core-uncaught-error core-unhandled-rejection core-error-handler-failed core-memory-view-invalid core-memory-view-detached core-wasm-not-initialized core-wasm-variant-mismatch core-shared-buffer-alloc-failed core-shared-memory-invalid-size core-shared-memory-exhausted core-shared-memory-sentinel-overwrite core-wasm-module-abi-mismatch core-advance-reentrant core-invalid-state-transition core-wasm-module-no-memory core-wasm-region-not-found core-wasm-channel-not-found core-wasm-module-not-found core-component-layout-invalid core-archetype-limit-reached core-query-invalid core-query-per-entity-path core-storage-inconsistent core-invalid-config core-plugin-not-found core-tween-pool-exhausted core-wasm-glue-mismatch core-engine-disposed core-wasm-capacity-exhausted"
    .split(" ")
    .sort();

function text(rel: string): string {
  const full = path.join(root, rel);
  return existsSync(full) ? readFileSync(full, "utf8") : "";
}

function pull(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );
}

describe("errors pages", () => {
  it("the EN and FR errors pages hold the same anchors", () => {
    const english = text("docs/api/errors.md");
    const french = text("docs/fr/api/errors.md");
    const anchors = pull(english, /\{#([a-z0-9-]+)\}/g).sort();
    expect(anchors).toEqual(ANCHORS);
    expect(pull(french, /\{#([a-z0-9-]+)\}/g).sort()).toEqual(anchors);
    const prefix = /^\| `([A-Z][A-Z0-9_]*)`\s+\|/gm;
    expect(pull(english, new RegExp(prefix))).toEqual(PREFIXES);
    expect(pull(french, new RegExp(prefix))).toEqual(PREFIXES);
  });
});
