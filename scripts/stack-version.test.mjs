import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import semver from "semver";

import { currentStamp, stampVersion } from "./stack/version.mjs";
import { git, initRepo } from "./stack/test-support.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionScript = join(repoRoot, "scripts/stack/version.mjs");

/**
 * @param {string} dir
 * @param {string[]} args
 * @returns {string}
 */
function gitClean(dir, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith("GIT_")) delete env[key];
  }
  env.GIT_TERMINAL_PROMPT = "0";
  const result = spawnSync("git", args, { cwd: dir, encoding: "utf8", env });
  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || "git failed").trim());
  }
  return (result.stdout || "").trim();
}

/**
 * @param {Record<string, string | undefined>} saved
 */
function restoreEnv(saved) {
  for (const key of Object.keys(saved)) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

test("the stamp is valid semver and satisfies ^1.0.0-alpha.0", () => {
  const stamp = stampVersion("abcdef0123456", new Date(Date.UTC(2026, 9, 22, 3, 15, 30)));
  assert.equal(stamp, "1.0.0-integration.20261022031530.gabcdef0");
  assert.equal(Boolean(semver.valid(stamp)), true);
  assert.equal(semver.satisfies(stamp, "^1.0.0-alpha.0"), true);
});

test("an all-digit sha with a leading zero would be invalid without the g prefix", () => {
  const date = new Date(Date.UTC(2026, 9, 22, 3, 15, 30));
  assert.equal(semver.valid("1.0.0-integration.0123456"), null);
  const stamp = stampVersion("0123456", date);
  assert.equal(Boolean(semver.valid(stamp)), true);
});

test("the CLI prints the stamp in UTC whatever TZ is", () => {
  const result = spawnSync(
    process.execPath,
    [versionScript, "--sha", "abc1234", "--now", "2026-01-02T03:04:05Z"],
    { encoding: "utf8", env: { ...process.env, TZ: "Pacific/Auckland" } },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout, "1.0.0-integration.20260102030405.gabc1234\n");
});

test("a sha shorter than 7 hex digits or not hex is refused with STACK:INVALID_SHA", () => {
  const date = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
  for (const sha of ["abc123", "xyz1234", "", "a".repeat(41)]) {
    assert.throws(
      () => stampVersion(sha, date),
      (error) => {
        assert.equal(error instanceof Error, true);
        assert.equal(error.message.startsWith("STACK:INVALID_SHA"), true);
        return true;
      },
    );
  }
  assert.equal(stampVersion("abc1234", date), "1.0.0-integration.20260102030405.gabc1234");
  assert.equal(
    stampVersion("a".repeat(40), date),
    `1.0.0-integration.20260102030405.g${"a".repeat(7)}`,
  );
});

test("currentStamp reads HEAD of the given repository", () => {
  const first = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const second = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  try {
    initRepo(first);
    writeFileSync(join(first, "marker.txt"), "one\n");
    git(first, ["add", "marker.txt"]);
    git(first, ["commit", "-m", "one"]);
    const firstHead = git(first, ["rev-parse", "HEAD"]);
    const now = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));
    const firstStamp = currentStamp({ cwd: first, now });
    assert.equal(firstStamp.endsWith(`.g${firstHead.slice(0, 7)}`), true);

    initRepo(second);
    writeFileSync(join(second, "marker.txt"), "two\n");
    git(second, ["add", "marker.txt"]);
    git(second, ["commit", "-m", "two"]);
    const secondHead = git(second, ["rev-parse", "HEAD"]);
    const secondStamp = currentStamp({ cwd: second, now });
    assert.equal(secondStamp.endsWith(`.g${secondHead.slice(0, 7)}`), true);
    assert.notEqual(firstHead.slice(0, 7), secondHead.slice(0, 7));
  } finally {
    rmSync(first, { recursive: true, force: true });
    rmSync(second, { recursive: true, force: true });
  }
});

test("currentStamp ignores a GIT_DIR inherited from a git hook", () => {
  const repo = mkdtempSync(join(tmpdir(), "gwen-stack-"));
  const decoy = mkdtempSync(join(tmpdir(), "gwen-stack-decoy-"));
  try {
    initRepo(repo);
    writeFileSync(join(repo, "marker.txt"), "one\n");
    git(repo, ["add", "marker.txt"]);
    git(repo, ["commit", "-m", "one"]);
    const head = gitClean(repo, ["rev-parse", "HEAD"]);
    const result = spawnSync(process.execPath, [versionScript, "--cwd", repo], {
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_DIR: decoy,
        GIT_INDEX_FILE: join(decoy, "index"),
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.endsWith(`.g${head.slice(0, 7)}\n`), true, result.stdout);
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});

test("fixture git helpers ignore a GIT_DIR inherited from a git hook", () => {
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "gwen-stack-")));
  const decoy = mkdtempSync(join(tmpdir(), "gwen-stack-decoy-"));
  const saved = {
    GIT_DIR: process.env.GIT_DIR,
    GIT_INDEX_FILE: process.env.GIT_INDEX_FILE,
    GIT_WORK_TREE: process.env.GIT_WORK_TREE,
  };
  process.env.GIT_DIR = decoy;
  process.env.GIT_INDEX_FILE = join(decoy, "index");
  process.env.GIT_WORK_TREE = join(decoy, "wt");
  let failure = "";
  try {
    try {
      initRepo(tmp);
      writeFileSync(join(tmp, "marker.txt"), "one\n");
      git(tmp, ["add", "marker.txt"]);
      git(tmp, ["commit", "-m", "one"]);
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
    let top = "";
    try {
      top = gitClean(tmp, ["rev-parse", "--show-toplevel"]);
    } catch (error) {
      if (!failure) failure = error instanceof Error ? error.message : String(error);
    }
    assert.equal(top, tmp, failure);
    assert.deepEqual(readdirSync(decoy), []);
  } finally {
    restoreEnv(saved);
    rmSync(tmp, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});
