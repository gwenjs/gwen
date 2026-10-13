import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "../../src");

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const enginePath = join(srcRoot, "engine/gwen-engine.ts");
const collaboratorsPath = join(srcRoot, "engine/engine-collaborators.ts");
const typesPath = join(srcRoot, "engine/engine-types.ts");
const errorsPath = join(srcRoot, "engine/engine-errors.ts");
const bridgePath = join(srcRoot, "engine/wasm-bridge.ts");
const readmePath = join(srcRoot, "README.md");

const ATTACH_DOC = [
  "  /**",
  "   * Attach a component to an entity.",
  "   * Merges `def.defaults` with the supplied `data` (data wins on conflict).",
  "   *",
  "   * @param id - Target entity",
  "   * @param def - Component definition",
  "   * @param data - Partial data to store (merged with defaults)",
  "   */",
].join("\n");

const TYPES_DOC = `/**
 * @file Engine public type contracts.
 *
 * Includes \`checkPluginApiVersion\`, which throws {@link GwenError}
 * \`CORE:WASM_API_VERSION_MISMATCH\` when policy is \`"throw"\`.
 */
`;

const ERRORS_DOC = `/**
 * @file Engine error types and error codes.
 *
 * Pure type/class definitions with no runtime
 * engine dependencies. Safe to import without pulling in the full engine module.
 */
`;

const FRAME_DOC = "/** Completed frames. In fixed mode, one per simulation step. */";
const POLICY_DOC = "/** Error policy for this engine. @internal */";
const GUARD =
  "`oxlint` `max-lines` 400, skipping blank lines and comments, covers `gwen-engine.ts` and `engine-loop.ts` only.";

function textAfter(source: string, block: string): string {
  const at = source.indexOf(block);
  expect(at).toBeGreaterThanOrEqual(0);
  return source.slice(at + block.length).trimStart();
}

describe("stale engine comments", () => {
  it("places the addComponent doc on addComponent", () => {
    const source = read(enginePath);
    const after = textAfter(source, ATTACH_DOC);
    expect(after.slice(0, "addComponent<".length)).toBe("addComponent<");
    const registerAt = source.indexOf("Rust component type id for `name`, owned by this engine.");
    expect(registerAt).toBeGreaterThanOrEqual(0);
    const registerAfter = source.slice(registerAt);
    const close = registerAfter.indexOf("*/");
    expect(close).toBeGreaterThanOrEqual(0);
    expect(
      registerAfter
        .slice(close + 2)
        .trimStart()
        .slice(0, "getOrRegisterComponent(".length),
    ).toBe("getOrRegisterComponent(");
  });

  it("documents _policy as the error policy", () => {
    const source = read(collaboratorsPath);
    expect(source).toContain(POLICY_DOC);
    expect(source).not.toContain("Caller `errorBus`, or `createErrorBus()` when omitted.");
    expect(source).toContain("protected readonly _policy: EngineErrorPolicy;");
  });

  it("drops the extracted-imports banner in gwen-engine", () => {
    const source = read(enginePath);
    expect(source).not.toContain("Imports from extracted");
    expect(source).toContain('from "./engine-errors.js"');
    expect(source).toContain('from "./engine-collaborators.js"');
  });

  it("documents frameCount as completed frames", () => {
    const source = read(enginePath);
    expect(source).toContain(FRAME_DOC);
    expect(source).not.toContain("completed `_runFrame` call");
  });

  it("states the engine-types contract without the old layout", () => {
    const source = read(typesPath);
    expect(source.slice(0, TYPES_DOC.length)).toBe(TYPES_DOC);
    expect(source).not.toContain("Extracted from gwen-engine.ts");
    expect(source).toContain("export function checkPluginApiVersion");
  });

  it("states the engine-errors contract without the old layout", () => {
    const source = read(errorsPath);
    expect(source.slice(0, ERRORS_DOC.length)).toBe(ERRORS_DOC);
    expect(source).not.toContain("Extracted from gwen-engine.ts");
    expect(source).toContain("export class GwenEngineStateError");
  });

  it("drops the unmeasured wasm-bridge split warning", () => {
    const source = read(bridgePath);
    expect(source).not.toContain("measurable perf");
    expect(source).not.toContain("Do not split");
    expect(source).not.toContain("extracted to wasm-bridge-types.ts");
    expect(source).toContain("The Rust/WASM core is MANDATORY");
    expect(source).toContain("NAVIGATION");
    expect(source).toContain("WASM_VARIANT_MISMATCH");
  });

  it("re-exports wasm-bridge types in the present tense", () => {
    const source = read(bridgePath);
    expect(source).toContain("Public types live in ./wasm-bridge-types.ts.");
    expect(source).not.toContain("before extraction");
    expect(source).toContain('from "./wasm-bridge-types.js"');
  });

  it("drops the wasm-bridge extracted-import banner", () => {
    const source = read(bridgePath);
    expect(source).not.toContain("Imports from extracted module");
    expect(source).toContain('from "./wasm-bridge-types.js"');
  });

  it("states the real max-lines guard in the core README", () => {
    const source = read(readmePath);
    expect(source).toContain(GUARD);
    expect(source).not.toContain("Keep files < 250 lines");
    expect(source).not.toContain("exceeds 300L");
    expect(source).toContain("scene-types.ts (100L)");
  });
});
