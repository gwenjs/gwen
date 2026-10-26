import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/retry-with-timeout.mjs");

/**
 * @param {string[]} args
 * @param {number} [timeoutMs]
 * @returns {import("node:child_process").SpawnSyncReturns<string>}
 */
function runRetry(args, timeoutMs = 15000) {
  return spawnSync(process.execPath, [script, ...args], {
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

/**
 * @param {string} file
 * @returns {string[]}
 */
function linesOf(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/**
 * @param {string} pidFile
 */
function killRecorded(pidFile) {
  if (!existsSync(pidFile)) return;
  for (const match of readFileSync(pidFile, "utf8").matchAll(/\b(\d+)\b/g)) {
    const pid = Number(match[1]);
    if (!Number.isInteger(pid) || pid <= 0) continue;
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already dead
    }
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isEsrch(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH";
}

/**
 * @param {number} pid
 */
function assertGone(pid) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (isEsrch(error)) return;
      throw error;
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
  assert.fail(`pid ${pid} is still running`);
}

test("retry-with-timeout runs a succeeding command once", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const counter = join(dir, "counter");
  try {
    const code = "require('node:fs').appendFileSync(process.argv[1], 'x\\n');";
    const result = runRetry([
      "--attempts",
      "3",
      "--timeout",
      "5",
      "--",
      process.execPath,
      "-e",
      code,
      counter,
    ]);
    assert.equal(result.status, 0, result.stderr ?? "");
    assert.equal(linesOf(counter).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout retries a failing command until it succeeds", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const counter = join(dir, "counter");
  try {
    const code = [
      "const fs = require('node:fs');",
      "const file = process.argv[1];",
      "const prev = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\\n').filter(Boolean).length : 0;",
      "fs.appendFileSync(file, 'x\\n');",
      "process.exit(prev === 0 ? 3 : 0);",
    ].join("");
    const result = runRetry([
      "--attempts",
      "3",
      "--timeout",
      "5",
      "--",
      process.execPath,
      "-e",
      code,
      counter,
    ]);
    assert.equal(result.status, 0, result.stderr ?? "");
    assert.equal(linesOf(counter).length, 2);
    assert.match(result.stderr ?? "", /attempt 2\/3/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout stops after N attempts and returns the last exit code", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const three = join(dir, "three");
  const one = join(dir, "one");
  try {
    const code = "require('node:fs').appendFileSync(process.argv[1], 'x\\n'); process.exit(7);";
    const thrice = runRetry([
      "--attempts",
      "3",
      "--timeout",
      "5",
      "--",
      process.execPath,
      "-e",
      code,
      three,
    ]);
    assert.equal(thrice.status, 7, thrice.stderr ?? "");
    assert.equal(linesOf(three).length, 3);
    const once = runRetry([
      "--attempts",
      "1",
      "--timeout",
      "5",
      "--",
      process.execPath,
      "-e",
      code,
      one,
    ]);
    assert.equal(once.status, 7, once.stderr ?? "");
    assert.equal(linesOf(one).length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout kills a hanging command and exits 124", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const pids = join(dir, "pids");
  try {
    const code = [
      "require('node:fs').appendFileSync(process.argv[1], String(process.pid) + '\\n');",
      "setInterval(() => {}, 1000000);",
    ].join("");
    const result = runRetry(
      ["--attempts", "2", "--timeout", "1", "--", process.execPath, "-e", code, pids],
      15000,
    );
    assert.notEqual(result.status, null);
    assert.equal(result.status, 124, result.stderr ?? "");
    const timedOut = (result.stderr ?? "").split("\n").filter((line) => line.includes("timed out"));
    assert.equal(timedOut.length, 2, result.stderr ?? "");
  } finally {
    killRecorded(pids);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout kills the whole process group", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const pidFile = join(dir, "grandchild.pid");
  try {
    const parentCode = [
      "const { spawn } = require('node:child_process');",
      "const pidFile = process.argv[1];",
      "const code = process.argv[2];",
      "spawn(process.execPath, ['-e', code, pidFile], { detached: false, stdio: 'ignore' });",
      "setInterval(() => {}, 1000000);",
    ].join("\n");
    const grandchildCode = [
      "require('node:fs').writeFileSync(process.argv[1], String(process.pid));",
      "setInterval(() => {}, 1000000);",
    ].join("\n");
    const result = runRetry(
      [
        "--attempts",
        "1",
        "--timeout",
        "2",
        "--",
        process.execPath,
        "-e",
        parentCode,
        pidFile,
        grandchildCode,
      ],
      10000,
    );
    assert.notEqual(result.status, null);
    assert.equal(result.status, 124, result.stderr ?? "");
    assert.equal(existsSync(pidFile), true, "grandchild did not write its pid");
    const pid = Number(readFileSync(pidFile, "utf8").trim());
    assertGone(pid);
  } finally {
    killRecorded(pidFile);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout rejects invalid usage with exit 2 and a message", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  try {
    const touch = "require('node:fs').appendFileSync(process.argv[1], 'x\\n');";
    /** @type {{ label: string, args: string[], counter: string }[]} */
    const cases = [
      { label: "attempts 0", attempts: "0", timeout: "1", mode: "command" },
      { label: "attempts 1.5", attempts: "1.5", timeout: "1", mode: "command" },
      { label: "attempts abc", attempts: "abc", timeout: "1", mode: "command" },
      { label: "timeout 0", attempts: "1", timeout: "0", mode: "command" },
      { label: "timeout -1", attempts: "1", timeout: "-1", mode: "command" },
      { label: "missing --", attempts: "1", timeout: "1", mode: "missing-separator" },
      { label: "nothing after --", attempts: "1", timeout: "1", mode: "empty-command" },
      { label: "unknown flag", attempts: "1", timeout: "1", mode: "unknown" },
      { label: "grace 0", attempts: "1", timeout: "1", grace: "0", mode: "command" },
      { label: "grace abc", attempts: "1", timeout: "1", grace: "abc", mode: "command" },
    ].map((item, index) => {
      const counter = join(dir, `counter-${index}`);
      const command = [process.execPath, "-e", touch, counter];
      /** @type {string[]} */
      let args = ["--attempts", item.attempts, "--timeout", item.timeout, "--", ...command];
      if ("grace" in item) {
        args = [
          "--attempts",
          item.attempts,
          "--timeout",
          item.timeout,
          "--grace",
          item.grace,
          "--",
          ...command,
        ];
      }
      if (item.mode === "missing-separator")
        args = ["--attempts", item.attempts, "--timeout", item.timeout, ...command];
      if (item.mode === "empty-command")
        args = ["--attempts", item.attempts, "--timeout", item.timeout, "--"];
      if (item.mode === "unknown") {
        args = ["--attempts", item.attempts, "--timeout", item.timeout, "--nope", "--", ...command];
      }
      return { label: item.label, args, counter };
    });
    for (const item of cases) {
      const result = runRetry(item.args);
      assert.equal(result.status, 2, `${item.label}\n${result.stderr ?? ""}`);
      assert.notEqual(result.stderr ?? "", "", item.label);
      assert.equal(existsSync(item.counter), false, item.label);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout counts a missing executable as a failed attempt with exit 127", () => {
  const result = runRetry([
    "--attempts",
    "2",
    "--timeout",
    "5",
    "--",
    "definitely-not-a-command-xyz",
  ]);
  assert.equal(result.status, 127, result.stderr ?? "");
  assert.match(result.stderr ?? "", /attempt 2\/2/);
});

const grandchildIgnoresSigterm = [
  "process.on('SIGTERM', () => {});",
  "setInterval(() => {}, 1000000);",
].join("\n");

test("retry-with-timeout waits for a SIGTERM-ignoring group to die before the next attempt", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const record = join(dir, "attempts");
  try {
    const parentCode = [
      "const { spawn } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const file = process.argv[1];",
      "const grandCode = process.argv[2];",
      "process.on('SIGTERM', () => {});",
      "const lines = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\\n').filter((line) => line !== '') : [];",
      "const last = lines.length > 0 ? lines[lines.length - 1] : '';",
      "let previousAlive = false;",
      "if (last !== '') {",
      "  const parts = Object.fromEntries(last.split(' ').map((part) => part.split('=')));",
      "  for (const pidText of [parts.child, parts.grand]) {",
      "    const pid = Number(pidText);",
      "    try {",
      "      process.kill(pid, 0);",
      "      previousAlive = true;",
      "    } catch (error) {",
      "      if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'ESRCH') previousAlive = true;",
      "    }",
      "  }",
      "}",
      "const grand = spawn(process.execPath, ['-e', grandCode], { stdio: 'ignore' });",
      "fs.appendFileSync(file, 'previousAlive=' + String(previousAlive) + ' child=' + String(process.pid) + ' grand=' + String(grand.pid) + '\\n');",
      "setInterval(() => {}, 1000000);",
    ].join("\n");
    const result = runRetry(
      [
        "--attempts",
        "2",
        "--timeout",
        "1",
        "--grace",
        "0.3",
        "--",
        process.execPath,
        "-e",
        parentCode,
        record,
        grandchildIgnoresSigterm,
      ],
      15000,
    );
    assert.notEqual(result.status, null);
    assert.equal(result.status, 124, result.stderr ?? "");
    const rows = linesOf(record).map((line) =>
      Object.fromEntries(line.split(" ").map((part) => part.split("="))),
    );
    assert.equal(rows.length, 2, result.stderr ?? "");
    assert.equal(rows[1]?.previousAlive, "false");
  } finally {
    killRecorded(record);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout SIGKILLs the group after the grace on the last attempt", () => {
  const dir = mkdtempSync(join(tmpdir(), "retry-with-timeout-"));
  const record = join(dir, "pids");
  try {
    const parentCode = [
      "const { spawn } = require('node:child_process');",
      "const fs = require('node:fs');",
      "const file = process.argv[1];",
      "const grandCode = process.argv[2];",
      "process.on('SIGTERM', () => {});",
      "const grand = spawn(process.execPath, ['-e', grandCode], { stdio: 'ignore' });",
      "fs.writeFileSync(file, String(process.pid) + '\\n' + String(grand.pid) + '\\n');",
      "setInterval(() => {}, 1000000);",
    ].join("\n");
    const result = runRetry(
      [
        "--attempts",
        "1",
        "--timeout",
        "1",
        "--grace",
        "0.3",
        "--",
        process.execPath,
        "-e",
        parentCode,
        record,
        grandchildIgnoresSigterm,
      ],
      15000,
    );
    assert.notEqual(result.status, null);
    assert.equal(result.status, 124, result.stderr ?? "");
    const pids = linesOf(record).map((line) => Number(line));
    assert.equal(pids.length, 2, result.stderr ?? "");
    assertGone(pids[0] ?? 0);
    assertGone(pids[1] ?? 0);
  } finally {
    killRecorded(record);
    rmSync(dir, { recursive: true, force: true });
  }
});

test("retry-with-timeout maps a signal death to 128 + signo", () => {
  const result = runRetry([
    "--attempts",
    "1",
    "--timeout",
    "5",
    "--",
    process.execPath,
    "-e",
    "process.kill(process.pid,'SIGTERM')",
  ]);
  assert.equal(result.status, 143, result.stderr ?? "");
});
