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
  "app-plugin-requirement-missing app-plugin-requirement-order app-service-provider-missing core-introspection-page-invalid core-outside-actor-context core-outside-cleanup-context core-outside-engine-context core-outside-layout-context core-outside-scene-context core-outside-system-context core-plugin-extension-api-mismatch renderer-foreign-layer-manager schema-invalid-config schema-modules-required"
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
