import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { listFrameworkPackages, packFramework } from "./stack/pack.mjs";
import { runNode, writeWorkspace } from "./stack/test-support.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packScript = join(repoRoot, "scripts/stack/pack.mjs");

/**
 * Names read from each packages star package.json without listFrameworkPackages.
 * @param {string} root
 * @returns {string[]}
 */
function independentPackageNames(root) {
  /** @type {string[]} */
  const names = [];
  const packagesDir = join(root, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(packagesDir, entry.name, "package.json");
    if (!existsSync(file)) continue;
    const pkg = JSON.parse(readFileSync(file, "utf8"));
    if (pkg.private === true) continue;
    names.push(pkg.name);
  }
  names.sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  return names;
}

/**
 * @param {string} tarball
 * @returns {string}
 */
function readPackedManifest(tarball) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-stack-tar-"));
  try {
    const result = spawnSync("tar", ["-xzf", tarball, "-C", dir], { encoding: "utf8" });
    assert.equal(result.status, 0);
    return readFileSync(join(dir, "package", "package.json"), "utf8");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * @param {string} root
 * @returns {Map<string, Buffer>}
 */
function packageBytes(root) {
  /** @type {Map<string, Buffer>} */
  const bytes = new Map();
  for (const entry of readdirSync(join(root, "packages"), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = join(root, "packages", entry.name, "package.json");
    if (existsSync(file)) bytes.set(file, readFileSync(file));
  }
  return bytes;
}

test("pack lists every framework package once", () => {
  const listed = listFrameworkPackages(repoRoot).map((pkg) => pkg.name);
  const expected = independentPackageNames(repoRoot);
  assert.deepEqual(listed, expected);
  assert.equal(new Set(listed).size, listed.length);
  assert.equal(listed.includes("@gwenjs/docs-check"), false);
  for (const name of ["@gwenjs/core", "@gwenjs/kit", "@gwenjs/schema", "@gwenjs/math"]) {
    assert.equal(listed.includes(name), true);
  }
});

test("two packages with the same name are refused with STACK:DUPLICATE_PACKAGE", () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(root, [
      { dir: "one", name: "@gwenjs/same" },
      { dir: "two", name: "@gwenjs/same" },
    ]);
    assert.throws(
      () => listFrameworkPackages(root),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.startsWith("STACK:DUPLICATE_PACKAGE"), true);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a workspace without packages is refused with STACK:NO_PACKAGES", () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(root, []);
    assert.throws(
      () => listFrameworkPackages(root),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.startsWith("STACK:NO_PACKAGES"), true);
        return true;
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a packed tarball carries the stamp and no workspace range", () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const out = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const stamp = "1.0.0-integration.20260102030405.gabc1234";
  try {
    writeWorkspace(root, [
      {
        dir: "a",
        name: "@gwenjs/stack-fixture-a",
        dependencies: { "@gwenjs/stack-fixture-b": "workspace:^" },
      },
      {
        dir: "b",
        name: "@gwenjs/stack-fixture-b",
        dependencies: { "@gwenjs/stack-fixture-a": "workspace:*" },
      },
    ]);
    packFramework({ root, out, version: stamp });
    const manifestPath = join(out, "stack-manifest.json");
    assert.equal(existsSync(manifestPath), true);
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    assert.equal(manifest.version, stamp);
    assert.equal(manifest.sha, "abc1234");
    assert.deepEqual(manifest.packages.map((pkg) => pkg.name).sort(), [
      "@gwenjs/stack-fixture-a",
      "@gwenjs/stack-fixture-b",
    ]);
    assert.equal(manifest.packages.length, 2);
    for (const packed of manifest.packages) {
      const text = readPackedManifest(join(out, "tarballs", packed.file));
      assert.equal(text.includes("workspace:"), false);
      const json = JSON.parse(text);
      assert.equal(json.version, stamp);
      if (packed.name === "@gwenjs/stack-fixture-a") {
        assert.equal(json.dependencies["@gwenjs/stack-fixture-b"], `^${stamp}`);
      }
      if (packed.name === "@gwenjs/stack-fixture-b") {
        assert.equal(json.dependencies["@gwenjs/stack-fixture-a"], stamp);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("exits 1 when one package fails to pack", () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const okRoot = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const out = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(okRoot, [{ dir: "a", name: "@gwenjs/stack-fixture-a" }]);
    const prepared = runNode(packScript, [
      "--root",
      okRoot,
      "--out",
      out,
      "--sha",
      "abc1234",
      "--now",
      "2026-01-02T03:04:05Z",
    ]);
    assert.equal(prepared.status, 0);
    assert.equal(existsSync(join(out, "stack-manifest.json")), true);

    writeWorkspace(root, [
      { dir: "a", name: "@gwenjs/stack-fixture-a" },
      {
        dir: "b",
        name: "@gwenjs/stack-fixture-b",
        scripts: { prepack: 'node -e "process.exit(1)"' },
      },
    ]);
    const result = runNode(packScript, [
      "--root",
      root,
      "--out",
      out,
      "--sha",
      "abc1234",
      "--now",
      "2026-01-02T03:04:05Z",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes("STACK:PACK_FAILED"), true);
    assert.equal(result.stderr.includes("@gwenjs/stack-fixture-b"), true);
    assert.equal(existsSync(join(out, "stack-manifest.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(okRoot, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("package.json files are restored byte for byte after a failed and after a successful pack", () => {
  const failedRoot = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const failedOut = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const okRoot = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const okOut = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(failedRoot, [
      { dir: "a", name: "@gwenjs/stack-fixture-a" },
      {
        dir: "b",
        name: "@gwenjs/stack-fixture-b",
        scripts: { prepack: 'node -e "process.exit(1)"' },
      },
    ]);
    const beforeFailed = packageBytes(failedRoot);
    const failed = runNode(packScript, [
      "--root",
      failedRoot,
      "--out",
      failedOut,
      "--sha",
      "abc1234",
      "--now",
      "2026-01-02T03:04:05Z",
    ]);
    assert.equal(failed.status, 1);
    for (const [file, bytes] of beforeFailed) {
      assert.deepEqual(readFileSync(file), bytes);
    }

    writeWorkspace(okRoot, [
      {
        dir: "a",
        name: "@gwenjs/stack-fixture-a",
        dependencies: { "@gwenjs/stack-fixture-b": "workspace:^" },
      },
      { dir: "b", name: "@gwenjs/stack-fixture-b" },
    ]);
    const beforeOk = packageBytes(okRoot);
    const ok = runNode(packScript, [
      "--root",
      okRoot,
      "--out",
      okOut,
      "--sha",
      "abc1234",
      "--now",
      "2026-01-02T03:04:05Z",
    ]);
    assert.equal(ok.status, 0);
    assert.equal(existsSync(join(okOut, "stack-manifest.json")), true);
    for (const [file, bytes] of beforeOk) {
      assert.deepEqual(readFileSync(file), bytes);
    }
  } finally {
    rmSync(failedRoot, { recursive: true, force: true });
    rmSync(failedOut, { recursive: true, force: true });
    rmSync(okRoot, { recursive: true, force: true });
    rmSync(okOut, { recursive: true, force: true });
  }
});

test("a workspace:~ range is refused with STACK:UNRESOLVED_WORKSPACE_RANGE", () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const out = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(root, [
      {
        dir: "a",
        name: "@gwenjs/stack-fixture-a",
        dependencies: { "@gwenjs/stack-fixture-b": "workspace:~" },
      },
      { dir: "b", name: "@gwenjs/stack-fixture-b" },
    ]);
    const manifest = join(root, "packages", "a", "package.json");
    const before = readFileSync(manifest);
    const result = runNode(packScript, [
      "--root",
      root,
      "--out",
      out,
      "--sha",
      "abc1234",
      "--now",
      "2026-01-02T03:04:05Z",
    ]);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.includes("STACK:UNRESOLVED_WORKSPACE_RANGE"), true);
    assert.equal(result.stderr.includes("@gwenjs/stack-fixture-a"), true);
    assert.equal(result.stderr.includes("@gwenjs/stack-fixture-b workspace:~"), true);
    assert.equal(existsSync(join(out, "stack-manifest.json")), false);
    assert.deepEqual(readFileSync(manifest), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});

test("a second pack with another stamp leaves only the new tarballs", () => {
  const root = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const out = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    writeWorkspace(root, [
      { dir: "a", name: "@gwenjs/stack-fixture-a" },
      { dir: "b", name: "@gwenjs/stack-fixture-b" },
    ]);
    const first = runNode(packScript, [
      "--root",
      root,
      "--out",
      out,
      "--sha",
      "abc1234",
      "--now",
      "2026-01-02T03:04:05Z",
    ]);
    const second = runNode(packScript, [
      "--root",
      root,
      "--out",
      out,
      "--sha",
      "abc1234",
      "--now",
      "2026-02-03T04:05:06Z",
    ]);
    assert.equal(first.status, 0);
    assert.equal(second.status, 0);
    const tarballDir = join(out, "tarballs");
    assert.equal(existsSync(tarballDir), true);
    const files = readdirSync(tarballDir);
    assert.equal(files.length > 0, true);
    assert.equal(
      files.every((name) => name.includes("20260203040506")),
      true,
    );
    assert.equal(
      files.some((name) => name.includes("20260102030405")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(out, { recursive: true, force: true });
  }
});
