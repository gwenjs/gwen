import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const TEST_SCRIPTS = "node --test scripts/*.test.mjs scripts/wasm-capacity/*.test.mjs";
const RUST_LINT_SCRIPTS = "pnpm check:unsafe && pnpm test:scripts";

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function jobBlock(yaml, id) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) return "";
  let end = start + 1;
  while (
    end < lines.length &&
    !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end] ?? "") &&
    !/^\S/.test(lines[end] ?? "")
  ) {
    end += 1;
  }
  return lines.slice(start, end).join("\n");
}

/**
 * @param {string} jobText
 * @returns {{ uses: string, run: string, continueOnError: boolean, hasIf: boolean }[]}
 */
function stepsOf(jobText) {
  const steps = [];
  let step = null;
  let runBlock = false;
  for (const line of jobText.split("\n")) {
    if (/^ {6}- /.test(line)) {
      if (step) steps.push(step);
      step = { uses: "", run: "", continueOnError: false, hasIf: false };
      runBlock = false;
      const uses = /^ {6}- uses: (\S+)/.exec(line);
      const run = /^ {6}- run: ?(.*)$/.exec(line);
      if (uses?.[1]) step.uses = uses[1];
      if (run) {
        if (run[1] === "|" || run[1] === ">") runBlock = true;
        else step.run = run[1] ?? "";
      }
      if (/^ {6}- continue-on-error:/.test(line)) step.continueOnError = true;
      if (/^ {6}- if:/.test(line)) step.hasIf = true;
      continue;
    }
    if (!step) continue;
    if (/^ {8}continue-on-error:/.test(line)) {
      step.continueOnError = true;
      continue;
    }
    if (/^ {8}if:/.test(line)) {
      step.hasIf = true;
      continue;
    }
    const uses = /^ {8}uses: (\S+)/.exec(line);
    const run = /^ {8}run: ?(.*)$/.exec(line);
    if (uses?.[1]) step.uses = uses[1];
    if (run) {
      if (run[1] === "|" || run[1] === ">") runBlock = true;
      else step.run = run[1] ?? "";
      continue;
    }
    if (runBlock && /^ {10}\S/.test(line)) {
      step.run = step.run ? `${step.run} && ${line.trim()}` : line.trim();
    } else if (runBlock && line.trim() !== "") {
      runBlock = false;
    }
  }
  if (step) steps.push(step);
  return steps;
}

test("root package.json defines test:scripts as the script glob", () => {
  const pkg = readJson(join(root, "package.json"));
  assert.equal(pkg.scripts["test:scripts"], TEST_SCRIPTS);
});

test("pnpm test ends with pnpm test:scripts", () => {
  const pkg = readJson(join(root, "package.json"));
  const parts = String(pkg.scripts["test"]).split("&&").map((part) => part.trim());
  assert.equal(parts.at(-1), "pnpm test:scripts");
});

test("rust-lint runs pnpm check:unsafe and pnpm test:scripts", () => {
  const yaml = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const step = stepsOf(jobBlock(yaml, "rust-lint")).find((item) => item.run === RUST_LINT_SCRIPTS);
  assert.ok(step, "missing run");
  assert.equal(step.continueOnError, false);
  assert.equal(step.hasIf, false);
});

test("rust-lint sets up Node with the pnpm composite action", () => {
  const yaml = readFileSync(join(root, ".github/workflows/ci.yml"), "utf8");
  const uses = stepsOf(jobBlock(yaml, "rust-lint")).map((step) => step.uses);
  assert.ok(uses.includes("./.github/actions/setup-node-pnpm"), uses.filter(Boolean).join("\n"));
});
