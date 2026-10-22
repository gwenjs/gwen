import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { AUDIT_ARGS, judgeAudit, runAudit } from "./npm-audit.mjs";

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "npm-audit");

/**
 * @param {string} name
 * @returns {{ text: string, json: unknown }}
 */
function fixture(name) {
  const text = readFileSync(join(fixturesDir, name), "utf8");
  return { text, json: JSON.parse(text) };
}

/**
 * @param {() => { stdout: string, stderr: string, status: number | null, error?: Error }} run
 * @returns {Promise<{ code: number, logged: string[], errors: string[], slept: number[] }>}
 */
async function audit(run) {
  /** @type {string[]} */
  const logged = [];
  /** @type {string[]} */
  const errors = [];
  /** @type {number[]} */
  const slept = [];
  const code = await runAudit({
    run,
    sleep(ms) {
      slept.push(ms);
    },
    log(line) {
      logged.push(line);
    },
    error(line) {
      errors.push(line);
    },
  });
  return { code, logged, errors, slept };
}

test("a high advisory fails", async () => {
  const { text, json } = fixture("high.json");
  const verdict = judgeAudit(json);
  assert.equal(verdict.fail, true);
  assert.equal(verdict.high, 2);
  assert.equal(verdict.moderate, 3);
  assert.equal(verdict.critical, 0);
  const { code, logged } = await audit(() => ({ stdout: text, stderr: "", status: 1 }));
  assert.equal(code, 1);
  assert.ok(logged.some((line) => line.includes("lodash") && line.includes("GHSA-")));
});

test("a critical advisory fails", async () => {
  const { text, json } = fixture("critical.json");
  const verdict = judgeAudit(json);
  assert.equal(verdict.fail, true);
  assert.equal(verdict.critical, 1);
  const { code, logged } = await audit(() => ({ stdout: text, stderr: "", status: 1 }));
  assert.equal(code, 1);
  assert.ok(logged.some((line) => line.startsWith("[npm-audit] critical minimist")));
});

test("moderate only passes and is printed", async () => {
  const { text, json } = fixture("moderate.json");
  const verdict = judgeAudit(json);
  assert.equal(verdict.fail, false);
  assert.equal(verdict.moderate, 1);
  const { code, logged } = await audit(() => ({ stdout: text, stderr: "", status: 1 }));
  assert.equal(code, 0);
  assert.ok(logged.some((line) => line.includes("[npm-audit] moderate word-wrap")));
  assert.ok(logged.includes("[npm-audit] high=0 critical=0 moderate=1"));
});

test("zero advisories passes", async () => {
  const { text, json } = fixture("clean.json");
  const verdict = judgeAudit(json);
  assert.equal(verdict.fail, false);
  const { code, logged } = await audit(() => ({ stdout: text, stderr: "", status: 0 }));
  assert.equal(code, 0);
  assert.deepEqual(logged, ["[npm-audit] high=0 critical=0 moderate=0"]);
});

test("non-JSON output is retried once then exits 2", async () => {
  let calls = 0;
  const { code, errors, slept } = await audit(() => {
    calls += 1;
    return {
      stdout: "Error: getaddrinfo ENOTFOUND registry.npmjs.org",
      stderr: "registry down\nmore",
      status: 1,
    };
  });
  assert.equal(calls, 2);
  assert.deepEqual(slept, [10000]);
  assert.equal(code, 2);
  assert.deepEqual(errors, ["[npm-audit] registry unreachable: registry down"]);
});

test("a transient non-JSON output then a good one passes after one retry", async () => {
  const { text } = fixture("clean.json");
  let calls = 0;
  const { code, slept } = await audit(() => {
    calls += 1;
    if (calls === 1) {
      return {
        stdout: "Error: getaddrinfo ENOTFOUND registry.npmjs.org",
        stderr: "",
        status: 1,
      };
    }
    return { stdout: text, stderr: "", status: 0 };
  });
  assert.equal(code, 0);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [10000]);
});

test("json without vulnerability counts is unusable and exits 2", async () => {
  const stdout = '{"error":{"code":"ERR_PNPM_AUDIT_BAD_RESPONSE"}}';
  assert.throws(
    () => judgeAudit(JSON.parse(stdout)),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message.startsWith("[npm-audit] unusable audit output"), true);
      return true;
    },
  );
  let calls = 0;
  const { code } = await audit(() => {
    calls += 1;
    return { stdout, stderr: "", status: 1 };
  });
  assert.equal(calls, 2);
  assert.equal(code, 2);
});

test("the verdict ignores the pnpm exit status", async () => {
  const high = fixture("high.json");
  const clean = fixture("clean.json");
  const ignoredSuccess = await audit(() => ({ stdout: high.text, stderr: "", status: 0 }));
  assert.equal(ignoredSuccess.code, 1);
  const ignoredFailure = await audit(() => ({ stdout: clean.text, stderr: "", status: 1 }));
  assert.equal(ignoredFailure.code, 0);
});

test("high is not masked by critical-only counting", () => {
  const verdict = judgeAudit({
    metadata: { vulnerabilities: { high: 1, critical: 0, moderate: 0 } },
  });
  assert.equal(verdict.fail, true);
});

test("a count that is not a number is unusable and exits 2", async () => {
  const cases = [
    {},
    { high: "1", critical: 0, moderate: 0 },
    { high: 1, critical: null, moderate: 0 },
    { high: -1, critical: 1, moderate: 0 },
    { high: 1.5, critical: 0, moderate: 0 },
  ];
  for (const vulnerabilities of cases) {
    const json = { metadata: { vulnerabilities } };
    assert.throws(
      () => judgeAudit(json),
      (error) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message.startsWith("[npm-audit] unusable audit output"), true);
        return true;
      },
    );
    let calls = 0;
    const { code, slept } = await audit(() => {
      calls += 1;
      return { stdout: JSON.stringify(json), stderr: "", status: 1 };
    });
    assert.equal(calls, 2);
    assert.deepEqual(slept, [10000]);
    assert.equal(code, 2);
  }
});

test("the audit command excludes devDependencies and asks for JSON", () => {
  assert.deepEqual(AUDIT_ARGS, ["audit", "--prod", "--json"]);
});

test("advisory lines are listed critical first, then high, then moderate", () => {
  const verdict = judgeAudit({
    metadata: { vulnerabilities: { high: 1, critical: 1, moderate: 1 } },
    advisories: {
      moderate: { severity: "moderate", module_name: "word-wrap", url: "https://example.test/m" },
      critical: { severity: "critical", module_name: "minimist", url: "https://example.test/c" },
      high: { severity: "high", module_name: "lodash", url: "https://example.test/h" },
    },
  });
  assert.deepEqual(verdict.lines, [
    "[npm-audit] high=1 critical=1 moderate=1",
    "[npm-audit] critical minimist https://example.test/c",
    "[npm-audit] high lodash https://example.test/h",
    "[npm-audit] moderate word-wrap https://example.test/m",
  ]);
});

test("an empty stderr falls back to the spawn error message", async () => {
  const spawned = await audit(() => ({
    stdout: "",
    stderr: "",
    status: null,
    error: new Error("spawnSync pnpm ENOENT\nextra"),
  }));
  assert.deepEqual(spawned.errors, ["[npm-audit] registry unreachable: spawnSync pnpm ENOENT"]);
  assert.equal(spawned.code, 2);

  const silent = await audit(() => ({
    stdout: "",
    stderr: "",
    status: null,
  }));
  assert.deepEqual(silent.errors, ["[npm-audit] registry unreachable: no error output"]);
  assert.equal(silent.code, 2);
});
