import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ scripts: Record<string, string> }} */
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const scripts = pkg.scripts;

test("root lint, lint:fix, format and format:check cover examples/", () => {
  for (const name of ["lint", "lint:fix", "format", "format:check"]) {
    assert.match(
      scripts[name] ?? "",
      /(?:^|\s)(?:packages\/ examples\/|examples\/ packages\/)$/,
      `${name} must pass both packages/ and examples/`,
    );
  }
});

test("root typecheck runs example:typecheck on every example package", () => {
  assert.match(
    scripts.typecheck ?? "",
    / && pnpm --filter 'example-\*' example:typecheck$/,
    "typecheck must end with the example:typecheck run on every example-* package",
  );
});

test("root test:wasm builds and tests the examples", () => {
  assert.equal(scripts["examples:build"], "pnpm --filter 'example-*' example:build");
  assert.equal(scripts["examples:test"], "pnpm --filter 'example-*' example:test");
  assert.match(
    scripts["test:wasm"] ?? "",
    / && pnpm examples:build && pnpm examples:test$/,
    "test:wasm must build then test the examples",
  );
});
