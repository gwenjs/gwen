import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import semver from "semver";

import { currentStamp, stampVersion } from "./stack/version.mjs";
import { git, initRepo } from "./stack/test-support.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const versionScript = join(repoRoot, "scripts/stack/version.mjs");

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
