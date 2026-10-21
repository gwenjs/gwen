import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const releaseGlue = readFileSync(
  new URL("./fixtures/wasm-factory/release-light.js", import.meta.url),
  "utf8",
);
const devGlue = readFileSync(
  new URL("./fixtures/wasm-factory/dev-physics2d.js", import.meta.url),
  "utf8",
);

const REAL_TAIL = "export { initSync, __wbg_init as default };";
const WASM_URL_LINE = "export const wasmUrl = new URL('gwen_core_bg.wasm', import.meta.url);";
const REFUSED_DIRS = ["packages/physics3d/wasm/bvh", "packages/physics3d/build-tools"];

/**
 * @param {string} glueFile
 */
function glueOpts(glueFile) {
  return {
    variant: glueFile.startsWith("dev-") ? "physics2d" : "light",
    glueFile,
    wasmBindgenVersion: "0.2.117",
    fingerprint: "",
  };
}

async function loadFactory() {
  const url = new URL("./wasm-factory.mjs", import.meta.url);
  const loaded = await import(url).catch((error) => error);
  return loaded;
}

/**
 * Names of top-level `export class` and `export function` bindings.
 * Line scan, separate from the production `export (class|function)` rule.
 * @param {string} source
 * @returns {string[]}
 */
function glueApiNames(source) {
  /** @type {string[]} */
  const names = [];
  for (const line of source.split("\n")) {
    const className = /^export class ([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (className?.[1]) names.push(className[1]);
    const functionName = /^export function ([A-Za-z_][A-Za-z0-9_]*)\b/.exec(line);
    if (functionName?.[1]) names.push(functionName[1]);
  }
  return names;
}

/**
 * @param {unknown} value
 * @returns {{ js: string, names: string[] }}
 */
function readOutput(value) {
  if (typeof value !== "object" || value === null) return { js: "", names: [] };
  const js = "js" in value && typeof value.js === "string" ? value.js : "";
  const contract = "contract" in value ? value.contract : undefined;
  const names =
    typeof contract === "object" &&
    contract !== null &&
    "names" in contract &&
    Array.isArray(contract.names)
      ? contract.names.filter((name) => typeof name === "string")
      : [];
  return { js, names };
}

/**
 * Body of `export function createGlue()`, or "" when that function is absent.
 * @param {string} source
 */
function createGlueBody(source) {
  const at = source.indexOf("export function createGlue()");
  if (at < 0) return "";
  const open = source.indexOf("{", at);
  if (open < 0) return "";
  let depth = 0;
  let quote = "";
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i] ?? "";
    if (quote !== "") {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl === -1 ? source.length : nl;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  return "";
}

/**
 * Drops every top-level `export class` / `export function` declaration.
 * @param {string} source
 */
function stripExportedApi(source) {
  /** @type {string[]} */
  const kept = [];
  let skipping = false;
  let depth = 0;
  for (const line of source.split("\n")) {
    if (!skipping && /^export (class|function) /.test(line)) {
      skipping = true;
      depth = 0;
    }
    if (skipping) {
      let sawBrace = false;
      for (const ch of line) {
        if (ch === "{") {
          depth += 1;
          sawBrace = true;
        } else if (ch === "}") {
          depth -= 1;
          sawBrace = true;
        }
      }
      if (sawBrace && depth <= 0) skipping = false;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * @param {unknown} loaded
 */
function requireTransform(loaded) {
  const transformGlue =
    typeof loaded === "object" && loaded !== null && "transformGlue" in loaded
      ? loaded.transformGlue
      : undefined;
  assert.equal(
    typeof transformGlue,
    "function",
    "scripts/wasm-factory.mjs must export transformGlue",
  );
  return /** @type {(source: string, opts: ReturnType<typeof glueOpts>) => unknown} */ (
    transformGlue
  );
}

test("release glue gives names derived from the glue", async () => {
  const transformGlue = requireTransform(await loadFactory());
  const { js, names } = readOutput(transformGlue(releaseGlue, glueOpts("release-light.js")));
  const line1 = js.split("\n")[0] ?? "";
  assert.deepEqual(names, glueApiNames(releaseGlue));
  assert.match(line1, /wasm-bindgen 0\.2\.117/);
  assert.match(line1, /release-light\.js/);
});

test("dev glue is accepted and exposes __wasm", async () => {
  const transformGlue = requireTransform(await loadFactory());
  const { js } = readOutput(transformGlue(devGlue, glueOpts("dev-physics2d.js")));
  assert.equal(js.includes("get __wasm() { return wasm; }"), true);
  assert.equal(js.includes("//#region"), false);
  assert.equal(js.includes("//#endregion"), false);
  assert.equal(js.includes("__wbindgen_start()"), true);
});

test("an extra top-level export fails and names the line", async () => {
  const transformGlue = requireTransform(await loadFactory());
  const source = `${releaseGlue.endsWith("\n") ? releaseGlue : `${releaseGlue}\n`}export const x = 1\n`;
  const line = source.split("\n").findIndex((row) => row === "export const x = 1") + 1;
  let message = "";
  try {
    transformGlue(source, glueOpts("release-light.js"));
  } catch (error) {
    if (error instanceof Error) message = error.message;
  }
  assert.match(
    message,
    new RegExp(`^\\[wasm-factory\\] unexpected top-level:? line ${line}: export const x = 1$`),
  );
});

test("a different tail fails", async () => {
  const transformGlue = requireTransform(await loadFactory());
  const lines = releaseGlue.split("\n");
  const at = lines.findIndex((line) => line === REAL_TAIL);
  assert.equal(at >= 0, true, "fixture tail missing");
  lines[at] = "export { initSync };";
  let message = "";
  try {
    transformGlue(lines.join("\n"), glueOpts("release-light.js"));
  } catch (error) {
    if (error instanceof Error) message = error.message;
  }
  assert.match(message, /tail/);
});

test("the bvh and build-tools outputs are refused", () => {
  for (const outDir of REFUSED_DIRS) {
    const result = spawnSync(process.execPath, ["scripts/wasm-factory.mjs", outDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    const stderr = `${result.stderr ?? ""}`;
    assert.equal(
      result.status === 1 && stderr.includes("[wasm-factory]") && stderr.includes(outDir),
      true,
      `status=${String(result.status)} stderr=${stderr}`,
    );
  }
});

test("wasmUrl is a top-level literal and import.meta.url is gone from createGlue", async () => {
  const transformGlue = requireTransform(await loadFactory());
  const { js } = readOutput(transformGlue(releaseGlue, glueOpts("release-light.js")));
  const body = createGlueBody(js);
  assert.equal(js.split("\n").includes(WASM_URL_LINE), true);
  assert.equal(body.length > 0 && !body.includes("import.meta.url"), true);
  assert.equal(js.includes("CORE:WASM_LOAD_ERROR"), true);
  assert.equal(js.includes("createGlue().init() needs { module_or_path }"), true);
});

test("a glue with no exported class fails", async () => {
  const transformGlue = requireTransform(await loadFactory());
  const source = stripExportedApi(releaseGlue);
  assert.equal(glueApiNames(source).length, 0);
  let message = "";
  try {
    transformGlue(source, glueOpts("release-light.js"));
  } catch (error) {
    if (error instanceof Error) message = error.message;
  }
  assert.equal(message, "[wasm-factory] no exported API");
});
