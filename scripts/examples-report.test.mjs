import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "examples/_harness/report.mjs");

/**
 * @param {string} dir
 */
function scrubbedEnv(dir) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
  return { ...env, GWEN_EXAMPLES_DIR: dir };
}

/**
 * @param {(dist: string, run: () => { stdout: string, status: number | null }) => void} body
 */
function withExample(body) {
  const dir = mkdtempSync(join(tmpdir(), "gwen-example-report-"));
  const dist = join(dir, "hello-light", "dist");
  try {
    mkdirSync(join(dist, "assets"), { recursive: true });
    writeFileSync(join(dist, "assets", "index.js"), "export const a = 1;\n");
    writeFileSync(join(dist, "core.wasm"), "wasm");
    const run = () => {
      const result = spawnSync("node", [script, "hello-light"], {
        encoding: "utf8",
        env: scrubbedEnv(dir),
      });
      return { stdout: result.stdout, status: result.status };
    };
    body(dist, run);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("report.mjs prints the sizes of dist and n/a for a frame time that was not measured", () => {
  withExample((_dist, run) => {
    const { stdout, status } = run();
    assert.equal(status, 0);
    assert.match(stdout, /### example-smoke: hello-light \(light\)/);
    assert.match(stdout, /\| \d+ B \| \d+ B \| n\/a \| n\/a \|/);
  });
});

test("report.mjs puts the frame time of dist/probe.json in the report and the summary", () => {
  withExample((dist, run) => {
    writeFileSync(join(dist, "probe.json"), '{"fps":59.5,"rawFrameTimeMs":16.25}\n');
    const { stdout } = run();
    assert.match(stdout, /\| 59\.5 fps \| 16\.3 ms \|/);
    const report = JSON.parse(readFileSync(join(dist, "gwen-example-report.json"), "utf8"));
    assert.equal(report.fps, 59.5);
    assert.equal(report.rawFrameTimeMs, 16.25);
  });
});

test("report.mjs says there is no build output when dist is absent", () => {
  const dir = mkdtempSync(join(tmpdir(), "gwen-example-report-"));
  try {
    const result = spawnSync("node", [script, "hello-light"], {
      encoding: "utf8",
      env: scrubbedEnv(dir),
    });
    assert.equal(result.status, 0);
    assert.match(result.stdout, /### example-smoke: hello-light: no build output/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
