import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const ENGINE = "packages/core/src/engine/gwen-engine.ts";
const LOOP = "packages/core/src/engine/engine-loop.ts";
const COLLABORATORS = "packages/core/src/engine/engine-collaborators.ts";

const MAX_LINES = ["error", { max: 400, skipBlankLines: true, skipComments: true }];

test("engine-collaborators.ts is in the same 400-line max-lines override", () => {
  const config = JSON.parse(readFileSync(join(root, "oxlint.json"), "utf8"));
  const overrides = Array.isArray(config.overrides) ? config.overrides : [];
  const guard = overrides.find(
    (entry) =>
      Array.isArray(entry.files) && entry.files.includes(ENGINE) && entry.files.includes(LOOP),
  );
  assert.ok(guard, "override that lists gwen-engine.ts and engine-loop.ts");
  assert.deepEqual(guard.files, [ENGINE, LOOP, COLLABORATORS]);
  assert.deepEqual(guard.rules["max-lines"], MAX_LINES);
});
