/**
 * The golden `system-iteration.optimized.ts` is the output of the whole pipeline
 * (`gwenVitePlugin({ optimizer: true })`: built-in units, then `OPTIMIZER_UNITS`) for
 * `system-iteration.source.ts`. It is committed so the bench and the alloc gate run what the
 * transform writes. Never edit it by hand. Regenerate it with:
 *   GWEN_UPDATE_GOLDEN=1 pnpm --filter @gwenjs/vite exec vitest run tests/hot-path/bench-fixture-sync.test.ts
 * The write runs after the source fixture is proven present and before the golden is read.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { BUILT_IN_UNITS, OPTIMIZER_UNITS } from "../../src/pipeline/registry.js";
import { resolveRelativeId, runPipeline } from "../transform-pipeline/helpers.js";

const packageRoot = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = fileURLToPath(
  new URL("../../../core/bench/fixtures/system-iteration.source.ts", import.meta.url),
);
const goldenPath = fileURLToPath(
  new URL("../../../core/bench/fixtures/system-iteration.optimized.ts", import.meta.url),
);

/** What `gwenVitePlugin({ optimizer: true })` writes for the source fixture. */
async function optimizedSource(): Promise<string> {
  const result = await runPipeline(readFileSync(sourcePath, "utf8"), {
    id: sourcePath,
    root: packageRoot,
    resolveId: resolveRelativeId,
    units: [...BUILT_IN_UNITS, ...OPTIMIZER_UNITS],
  });
  return result?.code ?? "";
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

it("hoistChunkColumns(system-iteration.source.ts) equals the committed golden byte for byte", async () => {
  expect(existsSync(sourcePath), "the source fixture exists").toBe(true);
  const code = await optimizedSource();
  if (process.env["GWEN_UPDATE_GOLDEN"] === "1") writeFileSync(goldenPath, code);
  expect(existsSync(goldenPath), "the golden fixture is committed").toBe(true);
  expect(readFileSync(goldenPath, "utf8")).toBe(code);
});

it("the golden reads each column once before the row loop and keeps chunk.count", () => {
  expect(existsSync(goldenPath), "the golden fixture is committed").toBe(true);
  const golden = readFileSync(goldenPath, "utf8");
  expect(golden).toContain("const _gwen_c0 = chunk.get(Position);");
  expect(golden).toContain("const _gwen_c1 = chunk.get(Velocity);");
  expect(golden).toContain("i < chunk.count");
  expect(occurrences(golden, "chunk.get(")).toBe(2);
});
