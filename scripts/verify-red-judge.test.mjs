import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const judgePath = join(dirname(fileURLToPath(import.meta.url)), "verify-red-judge.mjs");

/**
 * Run the judge on a head source, an optional base source and a runner report.
 *
 * @param {{ source: string, base?: string, format: string, report: string, extra?: string[] }} input
 * @returns {{ status: number | null, output: string }}
 */
function judge({ source, base, format, report, extra = [] }) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-"));
  try {
    writeFileSync(join(dir, "head.test.mjs"), source);
    writeFileSync(join(dir, "report.txt"), report);
    const args = [judgePath, "judge", "--source", join(dir, "head.test.mjs")];
    if (base !== undefined) {
      writeFileSync(join(dir, "base.test.mjs"), base);
      args.push("--base", join(dir, "base.test.mjs"));
    }
    args.push("--format", format, "--report", join(dir, "report.txt"), ...extra);
    const result = spawnSync("node", args, { encoding: "utf8" });
    return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("judge reads TAP names with an escaped # and backslash", () => {
  const { status, output } = judge({
    source:
      "import test from 'node:test';\ntest('rejects Fixes #12 and a \\\\ slash', () => {});\n",
    format: "tap",
    report: "TAP version 13\nnot ok 1 - rejects Fixes \\#12 and a \\\\ slash\n1..1\n",
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL rejects Fixes #12 and a \\ slash/);
});

test("judge still reads a TAP SKIP directive after an escaped #", () => {
  const { status, output } = judge({
    source: "import test from 'node:test';\ntest('issue #3', () => {});\n",
    format: "tap",
    report: "TAP version 13\nok 1 - issue \\#3 # SKIP\n1..1\n",
  });
  assert.equal(status, 1, output);
  assert.match(output, /PASS issue #3/);
});

test("judge rejects a new name that the runner never reported", () => {
  const kept = "import test from 'node:test';\ntest('kept', () => {});\n";
  const { status, output } = judge({
    source: `${kept}if (process.env.NEVER) test('new one', () => {});\n`,
    base: kept,
    format: "tap",
    report: "TAP version 13\nnot ok 1 - kept\n1..1\n",
  });
  assert.equal(status, 1, output);
  assert.match(output, /ABSENT new one/);
});

/**
 * @param {{ ancestorTitles: string[], title: string, status: string }[]} assertions
 * @returns {string}
 */
function vitestReport(assertions) {
  return JSON.stringify({
    testResults: [
      {
        name: "/repo/x.test.ts",
        status: "failed",
        message: "",
        assertionResults: assertions.map((a) => ({
          ...a,
          fullName: [...a.ancestorTitles, a.title].join(" "),
        })),
      },
    ],
  });
}

test("judge reads nested node:test subtests by their describe path", () => {
  const { status, output } = judge({
    source: [
      "import { describe, it } from 'node:test';",
      "describe('outer', () => {",
      "  describe('inner', () => {",
      "    it('deep', () => {});",
      "  });",
      "  it('flat', () => {});",
      "});",
      "",
    ].join("\n"),
    format: "tap",
    report: [
      "TAP version 13",
      "# Subtest: outer",
      "    # Subtest: inner",
      "        # Subtest: deep",
      "        not ok 1 - deep",
      "        1..1",
      "    not ok 1 - inner",
      "    # Subtest: flat",
      "    not ok 2 - flat",
      "    1..2",
      "not ok 1 - outer",
      "1..1",
      "",
    ].join("\n"),
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL outer > inner > deep/);
  assert.match(output, /FAIL outer > flat/);
});

test("judge tells the same title apart in two describe blocks", () => {
  const base = [
    "import { describe, it } from 'vitest';",
    "describe('dev', () => { it('light rejects', () => {}); });",
    "",
  ].join("\n");
  const source = `${base}describe('prod', () => { it('light rejects', () => {}); });\n`;
  const red = judge({
    source,
    base,
    format: "vitest",
    report: vitestReport([
      { ancestorTitles: ["dev"], title: "light rejects", status: "passed" },
      { ancestorTitles: ["prod"], title: "light rejects", status: "failed" },
    ]),
  });
  assert.equal(red.status, 0, red.output);
  assert.match(red.output, /KEEP dev > light rejects/);
  assert.match(red.output, /FAIL prod > light rejects/);
  const green = judge({
    source,
    base,
    format: "vitest",
    report: vitestReport([
      { ancestorTitles: ["dev"], title: "light rejects", status: "passed" },
      { ancestorTitles: ["prod"], title: "light rejects", status: "passed" },
    ]),
  });
  assert.equal(green.status, 1, green.output);
  assert.match(green.output, /PASS prod > light rejects/);
});

test("judge matches it.each titles and judges them", () => {
  const source = [
    "import { it, expect } from 'vitest';",
    "it.each([1, 2])('adds %i', (n) => { expect(n).toBe(0); });",
    "",
  ].join("\n");
  const red = judge({
    source,
    format: "vitest",
    report: vitestReport([
      { ancestorTitles: [], title: "adds 1", status: "failed" },
      { ancestorTitles: [], title: "adds 2", status: "failed" },
    ]),
  });
  assert.equal(red.status, 0, red.output);
  assert.match(red.output, /FAIL adds %i/);
});

test("judge keeps a passing dynamic title only when the base copy has it", () => {
  const loop = [
    "import test from 'node:test';",
    "for (const n of [1]) {",
    "  test(`case ${n}`, () => {});",
    "}",
    "",
  ].join("\n");
  const source = `${loop}test('fixed', () => {});\n`;
  const report = "TAP version 13\nok 1 - case 1\nnot ok 2 - fixed\n1..2\n";
  const added = judge({ source, format: "tap", report });
  assert.equal(added.status, 1, added.output);
  assert.match(added.output, /PASS case \$\{n\}/);
  const kept = judge({ source, base: loop, format: "tap", report });
  assert.equal(kept.status, 0, kept.output);
  assert.match(kept.output, /KEEP case \$\{n\}/);
  assert.match(kept.output, /FAIL fixed/);
});

test("judge blocks a new template or variable title that passes", () => {
  const template = judge({
    source: "import test from 'node:test';\ntest(`x ${\"y\"}`, () => {});\n",
    format: "tap",
    report: "TAP version 13\nok 1 - x y\n1..1\n",
  });
  assert.equal(template.status, 1, template.output);
  assert.match(template.output, /PASS x \$\{"y"\}/);
  const variable = judge({
    source: "import test from 'node:test';\nconst n = 'from a variable';\ntest(n, () => {});\n",
    format: "tap",
    report: "TAP version 13\nok 1 - from a variable\n1..1\n",
  });
  assert.equal(variable.status, 1, variable.output);
  assert.match(variable.output, /PASS <n>/);
});

test("judge blocks a new dynamic title the runner never reported", () => {
  const { status, output } = judge({
    source:
      "import test from 'node:test';\nif (process.env.NEVER) test(`case ${1}`, () => {});\ntest('fixed', () => {});\n",
    format: "tap",
    report: "TAP version 13\nnot ok 1 - fixed\n1..1\n",
  });
  assert.equal(status, 1, output);
  assert.match(output, /ABSENT case \$\{1\}/);
});

test("judge blocks a passing runner name that is in no source", () => {
  const shapes = [
    ["import { test as check } from 'vitest';", "check('renamed', () => {});"],
    ["import { test } from 'vitest';", "const t2 = test;", "t2('aliased', () => {});"],
    [
      "import { test } from 'vitest';",
      "const myTest = test.extend({});",
      "myTest('extended', () => {});",
    ],
  ];
  const titles = ["renamed", "aliased", "extended"];
  shapes.forEach((lines, k) => {
    const title = titles[k] ?? "";
    const { status, output } = judge({
      source: `${lines.join("\n")}\n`,
      format: "vitest",
      report: vitestReport([{ ancestorTitles: [], title, status: "passed" }]),
    });
    assert.equal(status, 1, `${title}\n${output}`);
    assert.match(output, new RegExp(`PASS ${title} \\(runner name not in source\\)`));
  });
  const failed = judge({
    source: "import { test as check } from 'vitest';\ncheck('renamed', () => {});\n",
    format: "vitest",
    report: vitestReport([{ ancestorTitles: [], title: "renamed", status: "failed" }]),
  });
  assert.match(failed.output, /WARN runner name not in source: renamed/);
});

test("judge reads $0 and $1 in a test.for title as placeholders", () => {
  const { status, output } = judge({
    source: "import { test } from 'vitest';\ntest.for([[1, 2]])('for $0 and $1', () => {});\n",
    format: "vitest",
    report: vitestReport([{ ancestorTitles: [], title: "for 1 and 2", status: "failed" }]),
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL for \$0 and \$1/);
});

test("judge warns about a runner name it cannot place instead of giving up", () => {
  const { status, output } = judge({
    source:
      "import test from 'node:test';\nconst name = 'from a variable';\ntest(name, () => {});\ntest('fixed', () => {});\n",
    format: "tap",
    report: "TAP version 13\nnot ok 1 - from a variable\nnot ok 2 - fixed\n1..2\n",
  });
  assert.equal(status, 0, output);
  assert.match(output, /FAIL fixed/);
});

const loadFailure = JSON.stringify({
  testResults: [
    {
      name: "/base/x.test.ts",
      status: "failed",
      message: "Cannot find module './lib' imported from '/base/x.test.ts'",
      assertionResults: [],
    },
  ],
});

/**
 * @param {string} dir
 * @param {string} text
 * @returns {string[]}
 */
function headReport(dir, text) {
  const file = join(dir, "head-report.txt");
  writeFileSync(file, text);
  return ["--head-report", file];
}

test("judge counts a base load failure red when the head runs the new names", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-head-"));
  try {
    const { status, output } = judge({
      source:
        "import { it } from 'vitest';\nimport { lib } from './lib';\nit('uses lib', () => {});\n",
      format: "vitest",
      report: loadFailure,
      extra: headReport(
        dir,
        vitestReport([{ ancestorTitles: [], title: "uses lib", status: "passed" }]),
      ),
    });
    assert.equal(status, 0, output);
    assert.match(output, /FAIL uses lib \(base load error: Cannot find module '\.\/lib'/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("judge asks for a head run when the base does not load", () => {
  const { status, output } = judge({
    source: "import { it } from 'vitest';\nit('uses lib', () => {});\n",
    format: "vitest",
    report: loadFailure,
  });
  assert.equal(status, 3, output);
  assert.match(output, /LOAD-ERROR Cannot find module/);
});

test("judge does not count a file that fails to load on the head too", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-head-"));
  try {
    const { status, output } = judge({
      source: "import { it } from 'vitest';\nit('needs wasm', () => {});\n",
      format: "vitest",
      report: loadFailure,
      extra: headReport(dir, loadFailure),
    });
    assert.equal(status, 2, output);
    assert.match(output, /does not load on the head either/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("judge reads a node:test load failure from the file entry", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-head-"));
  try {
    const { status, output } = judge({
      source:
        "import test from 'node:test';\nimport { x } from './lib.mjs';\ntest('uses lib', () => {});\n",
      format: "tap",
      report:
        "TAP version 13\n# Error [ERR_MODULE_NOT_FOUND]: Cannot find module\n# Subtest: dir/added.test.mjs\nnot ok 1 - dir/added.test.mjs\n1..1\n",
      extra: [
        "--file",
        "dir/added.test.mjs",
        ...headReport(dir, "TAP version 13\nok 1 - uses lib\n1..1\n"),
      ],
    });
    assert.equal(status, 0, output);
    assert.match(output, /FAIL uses lib \(base load error/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("judge still blocks a new name the head run does not report", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-head-"));
  try {
    const { status, output } = judge({
      source:
        "import { it } from 'vitest';\nit('uses lib', () => {});\nif (process.env.NEVER) it('hidden', () => {});\n",
      format: "vitest",
      report: loadFailure,
      extra: headReport(
        dir,
        vitestReport([{ ancestorTitles: [], title: "uses lib", status: "passed" }]),
      ),
    });
    assert.equal(status, 1, output);
    assert.match(output, /ABSENT hidden/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("judge ignores TAP lines quoted inside a YAML diagnostic block", () => {
  const { status, output } = judge({
    source: "import test from 'node:test';\ntest('real', () => {});\n",
    format: "tap",
    report: [
      "TAP version 13",
      "not ok 1 - real",
      "  ---",
      "  error: |-",
      "    not ok 1 - quoted from a child run",
      "  ...",
      "1..1",
      "",
    ].join("\n"),
  });
  assert.equal(status, 0, output);
  assert.doesNotMatch(output, /quoted from a child run/);
});

test("judge blocks a passing name it cannot place that equals a describe path", () => {
  const source = [
    "import { describe, test as check, test } from 'vitest';",
    "check('A', () => {});",
    "describe('A', () => { test('b', () => {}); });",
    "",
  ].join("\n");
  const vitest = judge({
    source,
    base: "import { test } from 'vitest';\n",
    format: "vitest",
    report: vitestReport([
      { ancestorTitles: [], title: "A", status: "passed" },
      { ancestorTitles: ["A"], title: "b", status: "failed" },
    ]),
  });
  assert.equal(vitest.status, 1, vitest.output);
  assert.match(vitest.output, /PASS A \(runner name not in source\)/);
  const tap = judge({
    source: source.replace("'vitest'", "'node:test'"),
    base: "import test from 'node:test';\n",
    format: "tap",
    report: [
      "TAP version 13",
      "# Subtest: A",
      "ok 1 - A",
      "# Subtest: A",
      "    # Subtest: b",
      "    not ok 1 - b",
      "    1..1",
      "not ok 2 - A",
      "1..2",
      "",
    ].join("\n"),
  });
  assert.equal(tap.status, 1, tap.output);
  assert.match(tap.output, /PASS A \(runner name not in source\)/);
});

test("judge warns about a passing name built by a helper when the base run passes it too", () => {
  const base = [
    "import { test } from 'vitest';",
    "import { conformance } from './helper';",
    "conformance();",
    "test('old', () => {});",
    "",
  ].join("\n");
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-base-run-"));
  try {
    const baseRun = join(dir, "base-run.json");
    writeFileSync(
      baseRun,
      vitestReport([
        { ancestorTitles: ["conformance"], title: "shared case", status: "passed" },
        { ancestorTitles: [], title: "old", status: "passed" },
      ]),
    );
    const input = {
      source: `${base}test('new', () => { throw new Error('red'); });\n`,
      base,
      format: "vitest",
      report: vitestReport([
        { ancestorTitles: ["conformance"], title: "shared case", status: "passed" },
        { ancestorTitles: [], title: "old", status: "passed" },
        { ancestorTitles: [], title: "new", status: "failed" },
      ]),
    };
    const warned = judge({ ...input, extra: ["--base-run", baseRun] });
    assert.equal(warned.status, 0, warned.output);
    assert.match(warned.output, /WARN runner name not in source, passes in the base run: conformance > shared case/);
    assert.match(warned.output, /FAIL new/);
    writeFileSync(baseRun, vitestReport([{ ancestorTitles: [], title: "old", status: "passed" }]));
    const blocked = judge({ ...input, extra: ["--base-run", baseRun] });
    assert.equal(blocked.status, 1, blocked.output);
    assert.match(blocked.output, /PASS conformance > shared case \(runner name not in source\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("judge keeps a new wasm-only Rust test that a native run does not report", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-judge-rs-"));
  try {
    const source = [
      "#[test]",
      "fn new_native() { assert_eq!(1, 2); }",
      "",
      "#[wasm_bindgen_test]",
      "fn new_wasm() {}",
      "",
    ].join("\n");
    writeFileSync(join(dir, "head.rs"), source);
    writeFileSync(join(dir, "base.rs"), "");
    writeFileSync(join(dir, "report.txt"), "running 1 test\ntest new_native ... FAILED\n");
    const result = spawnSync(
      "node",
      [judgePath, "judge", "--source", join(dir, "head.rs"), "--base", join(dir, "base.rs"), "--format", "cargo", "--report", join(dir, "report.txt")],
      { encoding: "utf8" },
    );
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, 0, output);
    assert.match(output, /FAIL new_native/);
    assert.match(output, /KEEP new_wasm \(wasm-only, not run natively\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
