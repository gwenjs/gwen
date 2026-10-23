import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { judge } from "./check-dist-identity.mjs";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-dist-identity.mjs");

const schemaDist = {
  pkg: "schema",
  path: "packages/schema/dist/index.js",
  text: 'class GwenError extends Error { constructor(code, message) { super(message); this.name = "GwenError"; this.code = code; } }\nexport { GwenError };',
};

const importingCoreDist = {
  pkg: "core",
  path: "packages/core/dist/chunks/dist.js",
  text: 'import { GwenError } from "@gwenjs/schema";\nexport class GwenContextError extends GwenError {}',
};

test("judge flags a dist that bundles the GwenError class", () => {
  const bundledCoreDist = {
    pkg: "core",
    path: "packages/core/dist/chunks/dist.js",
    text: 'var GwenError = class extends Error { constructor(e, t) { super(t), this.name = "GwenError", this.code = e; } };',
  };
  const problems = judge([schemaDist, bundledCoreDist]);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /bundles GwenError/);
});

test("judge accepts dists that import @gwenjs/schema", () => {
  assert.deepEqual(judge([schemaDist, importingCoreDist]), []);
});

test("judge names the offending file", () => {
  const bundledKitDist = {
    pkg: "kit",
    path: "packages/kit/dist/chunks/error.js",
    text: 'class A extends Error { constructor() { super(), this.name = "GwenError"; } }',
  };
  const problems = judge([schemaDist, importingCoreDist, bundledKitDist]);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].startsWith("packages/kit/dist/chunks/error.js:"), problems[0]);
});

test("judge flags the minified CJS form of the class", () => {
  const minified = {
    pkg: "math",
    path: "packages/math/dist/index.cjs",
    text: "var i=class extends Error{constructor(e,t){super(t),this.name=`GwenError`,this.code=e}};",
  };
  assert.equal(judge([minified]).length, 1);
});

test("judge flags the class-field form of the class", () => {
  const fieldForm = {
    pkg: "kit",
    path: "packages/kit/dist/index.js",
    text: 'class GwenError extends Error { name = "GwenError"; constructor(m) { super(m); } }',
  };
  assert.equal(judge([fieldForm]).length, 1);
  const subclassField = {
    pkg: "core",
    path: "packages/core/dist/index.js",
    text: 'class GwenContextError extends GwenError { name = "GwenContextError"; }',
  };
  assert.deepEqual(judge([subclassField]), []);
});

test("judge ignores a subclass that only sets its own name", () => {
  const subclass = {
    pkg: "core",
    path: "packages/core/dist/chunks/context.js",
    text: 'class GwenContextError extends GwenError { constructor(m) { super("c", m); this.name = "GwenContextError"; } }',
  };
  assert.deepEqual(judge([subclass]), []);
});

/**
 * Builds `packages/{schema,core}/dist/index.js` in a temp repo root and runs the CLI on it.
 * @param {string} coreSource
 * @returns {{ status: number, output: string }}
 */
function runCli(coreSource) {
  const root = mkdtempSync(join(tmpdir(), "dist-identity-"));
  try {
    writeFileSync(join(root, "package.json"), '{ "type": "module" }');
    for (const [pkg, source] of [
      ["schema", schemaDist.text],
      ["core", coreSource],
    ]) {
      mkdirSync(join(root, "packages", pkg, "dist"), { recursive: true });
      writeFileSync(join(root, "packages", pkg, "dist", "index.js"), source);
    }
    try {
      const output = execFileSync(process.execPath, [script, "--root", root], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { status: 0, output };
    } catch (error) {
      return { status: error.status ?? 1, output: `${error.stdout}${error.stderr}` };
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("the CLI exits 1 and lists a core dist that bundles GwenError", () => {
  const result = runCli(
    'class GwenError extends Error { constructor(m) { super(m); this.name = "GwenError"; } }\nexport class GwenContextError extends GwenError {}',
  );
  assert.equal(result.status, 1);
  assert.match(result.output, /packages\/core\/dist\/index\.js: bundles GwenError/);
  assert.match(result.output, /probe: core\.GwenContextError is not instanceof/);
});

test("the CLI exits 0 when core extends the GwenError of schema", () => {
  const result = runCli(
    'import { GwenError } from "../../schema/dist/index.js";\nexport class GwenContextError extends GwenError {}',
  );
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /Dist identity ok/);
});
