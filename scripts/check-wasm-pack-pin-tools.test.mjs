import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const pin = JSON.parse(readFileSync(path.join(repoRoot, "wasm-size.json"), "utf8")).toolchain
  .wasmPack;

/**
 * @param {string} version
 * @param {number} buildStatus
 */
function fakeWasmPack(version, buildStatus) {
  const dir = mkdtempSync(path.join(tmpdir(), "gwen-wasm-pack-"));
  const log = path.join(dir, "args.txt");
  const bin = path.join(dir, "wasm-pack");
  writeFileSync(
    bin,
    `#!/bin/sh
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [ "$1" = "--version" ]; then
  echo "wasm-pack ${version}"
  exit 0
fi
exit ${buildStatus}
`,
  );
  chmodSync(bin, 0o755);
  return { dir, log };
}

/**
 * @param {string} binDir
 */
function runTools(binDir) {
  return spawnSync("bash", ["scripts/build-wasm-tools.sh"], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, PATH: `${binDir}:/usr/bin:/bin` },
  });
}

test("build-wasm-tools.sh refuses a wasm-pack version other than the pin", () => {
  const wrong = fakeWasmPack("9.9.9", 1);
  try {
    const refused = runTools(wrong.dir);
    const text = `${refused.stdout}\n${refused.stderr}`;
    assert.notEqual(refused.status, 0);
    assert.ok(text.includes(`wasm-pack 9.9.9 != wasm-size.json toolchain.wasmPack ${pin}`), text);
    const called = existsSync(wrong.log) && readFileSync(wrong.log, "utf8").includes("build");
    assert.equal(called, false);
  } finally {
    rmSync(wrong.dir, { recursive: true, force: true });
  }
});

test("build-wasm-tools.sh reaches wasm-pack build with the pinned version", () => {
  const matched = fakeWasmPack(pin, 42);
  try {
    const reached = runTools(matched.dir);
    const lines = readFileSync(matched.log, "utf8").trim().split("\n");
    assert.equal(lines[0], "--version");
    assert.equal(reached.status, 42, `${reached.stdout}\n${reached.stderr}`);
    assert.equal(
      lines.some((line) => line.startsWith("build")),
      true,
    );
  } finally {
    rmSync(matched.dir, { recursive: true, force: true });
  }
});
