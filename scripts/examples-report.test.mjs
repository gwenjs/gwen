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

const BUILD_ID_A = "0".repeat(64);
const BUILD_ID_B = "9f2c4be8a1d36705c8e41fb2a7d95036e1b4c8a72f3d5e60b9a1c4d7e2f80356";

/** Runs report.mjs on a dist whose only chunk is `source` and returns the `jsGzipBytes` it writes. */
function jsGzipBytesOf(source) {
  let bytes = -1;
  withExample((dist, run) => {
    writeFileSync(join(dist, "assets", "index.js"), source);
    assert.equal(run().status, 0);
    bytes = JSON.parse(readFileSync(join(dist, "gwen-example-report.json"), "utf8")).jsGzipBytes;
  });
  return bytes;
}

/** A chunk shaped like the entry chunk of an example: a wasm glue contract and the wasm asset URL. */
function chunk({ contract, wasmHash = "BdQ1WP0Y", workerHash = "EzIvBQ2d" }) {
  return [
    "const a=1;function f(x){return x+a}",
    `const w=new URL(\`/assets/gwen_core_bg-${wasmHash}.wasm\`,import.meta.url);`,
    `const k=new Worker(new URL(\`/assets/bvh-worker-${workerHash}.js\`,import.meta.url));`,
    contract,
    "export{f,w,k};",
    "",
  ].join("\n");
}

test("report.mjs measures the same js gzip size for two wasm builds that differ only by their build id", () => {
  const withId = (id) =>
    chunk({ contract: `const c={buildId:\`${id}\`,fingerprint:\`gwen-core\`};` });
  assert.equal(jsGzipBytesOf(withId(BUILD_ID_A)), jsGzipBytesOf(withId(BUILD_ID_B)));
  // Both sides of the boundary: only a 64 character id after the `buildId` key is replaced.
  const other = (body) => chunk({ contract: `const c={${body}};` });
  assert.notEqual(
    jsGzipBytesOf(other(`salt:\`${BUILD_ID_A}\``)),
    jsGzipBytesOf(other(`salt:\`${BUILD_ID_B}\``)),
    "a 64 character value after another key still counts",
  );
  assert.notEqual(
    jsGzipBytesOf(other(`buildId:\`${BUILD_ID_A.slice(1)}\``)),
    jsGzipBytesOf(other(`buildId:\`${BUILD_ID_B.slice(1)}\``)),
    "a 63 character build id still counts",
  );
  assert.notEqual(
    jsGzipBytesOf(other(`buildId:\`${BUILD_ID_A}0\``)),
    jsGzipBytesOf(other(`buildId:\`${BUILD_ID_B}a\``)),
    "a 65 character build id still counts",
  );
});

test("report.mjs measures the same js gzip size for two wasm builds that differ only by their asset hashes", () => {
  const contract = "const c={buildId:`" + BUILD_ID_B + "`};";
  assert.equal(
    jsGzipBytesOf(chunk({ contract, wasmHash: "BdQ1WP0Y", workerHash: "EzIvBQ2d" })),
    jsGzipBytesOf(chunk({ contract, wasmHash: "aaaaaaaa", workerHash: "bbbbbbbb" })),
  );
});
