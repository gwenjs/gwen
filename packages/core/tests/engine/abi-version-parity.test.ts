import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GWEN_PLUGIN_API_VERSION } from "../../src/engine/engine-types";

const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const libPath = join(repoRoot, "crates/gwen-wasm-utils/src/lib.rs");

/** Underscores are allowed in the Rust literal (`1_000_000`). */
const DECLARATION = /^pub const GWEN_PLUGIN_API_VERSION: i32 = ([0-9_]+);/m;

describe("ABI version parity", () => {
  it("reads the rust literal of GWEN_PLUGIN_API_VERSION and matches the typescript constant", () => {
    const src = readFileSync(libPath, "utf8");
    const match = DECLARATION.exec(src);
    expect(match).not.toBeNull();
    const digits = match?.[1]?.replaceAll("_", "") ?? "";
    expect(Number(digits)).toBe(GWEN_PLUGIN_API_VERSION);
  });
});
