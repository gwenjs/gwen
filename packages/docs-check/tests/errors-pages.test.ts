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
  "app-config-conflict app-config-invalid app-config-load-failed app-module-load-failed app-module-setup-failed app-plugin-not-declarative app-plugin-requirement-missing app-plugin-requirement-order app-service-provider-missing camera-empty-path camera-perspective-fallback camera-priority-conflict camera-viewport-not-found conformance-attw conformance-augment-target conformance-exports-invalid conformance-hook-dynamic-name conformance-hook-foreign-namespace conformance-hook-namespace-invalid conformance-hook-reserved conformance-hook-undeclared conformance-import-deep conformance-import-forbidden-entry conformance-import-foreign-plugin conformance-import-internal conformance-import-not-public conformance-import-undeclared conformance-invalid-spec conformance-manifest conformance-private-export conformance-publint conformance-readme-export-missing conformance-snapshot-mismatch conformance-test-mocks-framework core-actor-circular-ownership core-actor-no-live-instance core-actor-plugin-not-ready core-actor-pool-exhausted core-advance-reentrant core-archetype-limit-reached core-buffer-length-mismatch core-component-layout-invalid core-component-type-in-use core-component-type-limit-reached core-component-write-rejected core-definition-incomplete core-engine-disposed core-engine-local-reentrant core-entity-limit-reached core-error-handler-failed core-frame-loop-error core-hook-name-invalid core-introspection-page-invalid core-invalid-chunk-size core-invalid-component-schema core-invalid-component-type core-invalid-config core-invalid-engine core-invalid-entity-id core-invalid-max-entities core-invalid-parent core-invalid-scene-route core-invalid-shared-buffer core-invalid-state-transition core-layout-dispose-failed core-layout-handle-not-spawned core-layout-load-failed core-memory-view-detached core-memory-view-invalid core-outside-actor-context core-outside-cleanup-context core-outside-engine-context core-outside-layout-context core-outside-scene-context core-outside-system-context core-plugin-dependency-missing core-plugin-extension-api-mismatch core-plugin-in-use core-plugin-invalid-shape core-plugin-not-found core-plugin-options-invalid core-plugin-provide-duplicate core-plugin-provide-missing core-plugin-provide-undeclared core-plugin-runtime-error core-plugin-setup-error core-query-capacity-exceeded core-query-invalid core-query-per-entity-path core-shared-buffer-alloc-failed core-shared-memory-exhausted core-shared-memory-invalid-size core-shared-memory-sentinel-overwrite core-storage-inconsistent core-tween-pool-exhausted core-uncaught-error core-unhandled-rejection core-wasm-capacity-exhausted core-wasm-channel-not-found core-wasm-glue-mismatch core-wasm-load-error core-wasm-module-abi-mismatch core-wasm-module-no-memory core-wasm-module-not-found core-wasm-module-region-invalid core-wasm-module-region-too-small core-wasm-not-initialized core-wasm-panic core-wasm-region-not-found core-wasm-timeout core-wasm-variant-mismatch kit-module-invalid kit-plugin-setup-failed math-invalid-hex-color physics2d-body-already-exists physics2d-body-not-found physics2d-buffer-length-mismatch physics2d-invalid-body-kind physics2d-invalid-collider physics2d-invalid-layers physics2d-invalid-path-request physics2d-invalid-prefab-extension physics2d-invalid-query physics2d-invalid-step-delta physics2d-not-initialized physics2d-position-component-required physics2d-stale-body-handle physics2d-stale-entity physics2d-tilemap-chunk-already-loaded physics2d-tilemap-chunk-not-loaded physics2d-unknown-layer physics2d-wasm-variant-mismatch physics3d-body-already-exists physics3d-body-not-found physics3d-buffer-length-mismatch physics3d-bvh-callback-hang physics3d-bvh-load-failed physics3d-bvh-worker-timeout physics3d-character-controller-limit-reached physics3d-character-controller-not-found physics3d-collider-already-exists physics3d-collider-not-found physics3d-convex-fallback physics3d-invalid-body-kind physics3d-invalid-collider physics3d-invalid-compound physics3d-invalid-joint physics3d-invalid-mesh-buffer physics3d-invalid-navgrid physics3d-invalid-path-request physics3d-invalid-query physics3d-invalid-shape physics3d-invalid-step-delta physics3d-joint-not-found physics3d-mesh-fallback physics3d-mesh-rebuild-failed physics3d-navgrid-not-initialized physics3d-no-rigid-body physics3d-not-initialized physics3d-stale-entity physics3d-unknown-layer physics3d-wasm-variant-mismatch renderer-already-registered renderer-conformance-failed renderer-contract-version renderer-foreign-layer-manager renderer-layer-order-conflict renderer-missing-layer renderer-screen-resize-observer-not-available renderer-screen-to-world-perspective renderer-screen-viewport-not-found renderer-surface-invalid renderer-unavailable-camera renderer-unknown-layer schema-invalid-config schema-modules-required vite-main-scene-unknown vite-optimizer-unknown-component vite-optimizer-unknown-field vite-scene-name-duplicate vite-scene-name-unresolved vite-wasm-not-found"
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
