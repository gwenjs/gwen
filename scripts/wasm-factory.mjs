#!/usr/bin/env node
/**
 * Turn wasm-bindgen `--target web` glue into a per-instance factory.
 *
 * The stock glue keeps its instance, heap and finalizers at module scope.
 * `createGlue()` wraps that state so two calls do not share one WASM instance.
 *
 *   node scripts/wasm-factory.mjs <out_dir>
 *
 * Reads `gwen_core.js`, `gwen_core.d.ts` and `gwen_core_bg.wasm` from `out_dir`.
 * Writes `gwen_core_factory.js` and `gwen_core_factory.d.ts` next to them.
 * No dependency. The ten rules below run in order. A failure throws
 * `Error("[wasm-factory] <rule>: line <n>: <text>")`. The CLI prints that
 * message on stderr and exits 1.
 */

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Output directories this script must not touch. Checked before any read. */
const REFUSED_OUT_DIRS = ["packages/physics3d/wasm/bvh", "packages/physics3d/build-tools"];

/** The only legal re-export tail of `--target web` glue. */
const TAIL = /^export \{ initSync, __wbg_init as default \};\s*$/;

/** Dev glue appends this so a debugger can see the raw instance. No semicolon. */
const RAW_EXPORT = /^export \{ wasm as __wasm \};?\s*$/;

/** Fold markers wasm-bindgen emits around debug glue. */
const REGION = /^\/\/#(end)?region\b/;

/** Top-level API the factory re-exports. Names come from the glue, never a list. */
const API_EXPORT = /^export (class|function) ([A-Za-z_][A-Za-z0-9_]*)\b/;

/** A statement wasm-bindgen did not account for, still at column 0. */
const TOP_LEVEL = /^(import|export)\b/;

/** The one module-level WASM slot. Release glue uses the two-name form. */
const WASM_BINDING = /^let wasmModule, wasm;\s*$|^let wasm;\s*$/;

/** The fetch fallback inside `__wbg_init`. The factory replaces this once. */
const WASM_URL_ASSIGN = "module_or_path = new URL('gwen_core_bg.wasm', import.meta.url);";

const WASM_URL_LINE = "export const wasmUrl = new URL('gwen_core_bg.wasm', import.meta.url);";

const LOAD_THROW =
  'throw Object.assign(new Error("[GWEN] createGlue().init() needs { module_or_path }; pass the compiled module."), { code: "CORE:WASM_LOAD_ERROR" });';

/**
 * @typedef {Object} GlueFactoryOptions
 * @property {string} variant
 * @property {string} glueFile
 * @property {string} wasmBindgenVersion
 * @property {string} fingerprint
 */

/**
 * @typedef {Object} GlueContract
 * @property {string} fingerprint
 * @property {string[]} names
 * @property {string[]} rawExports
 * @property {string[]} imports
 */

/**
 * @typedef {Object} SourceRow
 * @property {number} line 1-based line in the original glue
 * @property {string} text
 */

/**
 * @param {string} rule
 * @param {number} line
 * @param {string} text
 * @returns {Error}
 */
function ruleError(rule, line, text) {
  return new Error(`[wasm-factory] ${rule}: line ${line}: ${text}`);
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isEnoent(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * Absolute location of `outDir` from the process cwd.
 * The nearest existing ancestor is resolved for real, so a symlink cannot hide
 * a refused tree. When nothing on the path exists, this is `path.resolve`.
 * @param {string} outDir
 * @returns {string}
 */
function resolveOutDir(outDir) {
  const absolute = path.resolve(outDir);
  /** @type {string[]} */
  const missing = [];
  let cursor = absolute;
  while (true) {
    try {
      const real = realpathSync(cursor);
      return missing.length === 0 ? real : path.join(real, ...missing);
    } catch (error) {
      if (!isEnoent(error)) return absolute;
      const parent = path.dirname(cursor);
      if (parent === cursor) return absolute;
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

/**
 * Rule 1. True when `outDir` is the BVH worker or the Node build-tools tree,
 * or a directory under either of them. Compared after resolution, from the repo root.
 * @param {string} outDir
 * @returns {boolean}
 */
export function isRefusedOutDir(outDir) {
  const relative = path.relative(ROOT, resolveOutDir(outDir));
  return REFUSED_OUT_DIRS.some(
    (marker) => relative === marker || relative.startsWith(`${marker}${path.sep}`),
  );
}

/**
 * @param {string} source
 * @returns {SourceRow[]}
 */
function sourceRows(source) {
  const text = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
  return text.split("\n").map((line, index) => ({ line: index + 1, text: line }));
}

/**
 * @param {string[]} values
 * @returns {string[]}
 */
function uniqueSorted(values) {
  return [...new Set(values.filter((name) => name.length > 0))].sort();
}

/**
 * @param {string} body
 * @returns {string[]}
 */
function rawExportNames(body) {
  return uniqueSorted(
    [...body.matchAll(/\bwasm\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1] ?? ""),
  );
}

/**
 * Keys of the wasm-bindgen import object (`__wbg_*` / `__wbindgen_*`).
 * @param {string} body
 * @returns {string[]}
 */
function importNames(body) {
  return uniqueSorted(
    [...body.matchAll(/^\s+((?:__wbg_|__wbindgen_)[\w$]+):\s*function/gm)].map(
      (match) => match[1] ?? "",
    ),
  );
}

/**
 * @param {GlueFactoryOptions} options
 * @returns {GlueFactoryOptions}
 */
function readOptions(options) {
  const variant = options.variant;
  const glueFile = options.glueFile;
  const wasmBindgenVersion = options.wasmBindgenVersion;
  const fingerprint = options.fingerprint;
  if (typeof variant !== "string" || variant.length === 0) {
    throw ruleError("variant", 0, "expected a non-empty string");
  }
  if (typeof glueFile !== "string" || glueFile.length === 0) {
    throw ruleError("glueFile", 0, "expected a non-empty string");
  }
  if (typeof wasmBindgenVersion !== "string" || wasmBindgenVersion.length === 0) {
    throw ruleError("wasm-bindgen version", 0, "expected a non-empty string");
  }
  if (typeof fingerprint !== "string") {
    throw ruleError("fingerprint", 0, "expected a string");
  }
  return { variant, glueFile, wasmBindgenVersion, fingerprint };
}

/**
 * Rule 2. The tail must occur once. It is removed so rule 5 does not see it.
 * @param {SourceRow[]} rows
 * @returns {SourceRow[]}
 */
function dropTail(rows) {
  const hits = rows.filter((row) => TAIL.test(row.text));
  if (hits.length !== 1) {
    const suspect = hits[1] ?? hits[0] ?? rows.find((row) => row.text.startsWith("export {"));
    const line = suspect?.line ?? 0;
    const text = suspect?.text ?? "missing export { initSync, __wbg_init as default };";
    throw ruleError("tail", line, text);
  }
  const tailLine = hits[0]?.line;
  return rows.filter((row) => row.line !== tailLine);
}

/**
 * Rule 3. Drop one optional dev re-export and every region marker.
 * @param {SourceRow[]} rows
 * @returns {{ rows: SourceRow[], exposeRaw: boolean }}
 */
function dropDevMarkers(rows) {
  let exposeRaw = false;
  /** @type {SourceRow[]} */
  const kept = [];
  for (const row of rows) {
    if (!exposeRaw && RAW_EXPORT.test(row.text)) {
      exposeRaw = true;
      continue;
    }
    if (REGION.test(row.text)) continue;
    kept.push(row);
  }
  return { rows: kept, exposeRaw };
}

/**
 * Rule 4. Collect `export class` / `export function` names and strip `export`.
 * @param {SourceRow[]} rows
 * @returns {string[]}
 */
function collectNames(rows) {
  /** @type {string[]} */
  const names = [];
  for (const row of rows) {
    const match = API_EXPORT.exec(row.text);
    const name = match?.[2];
    if (!name) continue;
    names.push(name);
    row.text = row.text.replace(/^export /, "");
  }
  return names;
}

/**
 * Rule 5. Anything still `import`/`export` at column 0 is a shape we do not wrap.
 * The line number is the 1-based line in the source glue.
 * @param {SourceRow[]} rows
 */
function rejectUnexpected(rows) {
  for (const row of rows) {
    if (!TOP_LEVEL.test(row.text)) continue;
    throw new Error(`[wasm-factory] unexpected top-level line ${row.line}: ${row.text}`);
  }
}

/**
 * Rule 6. Exactly one module-level wasm slot.
 * @param {SourceRow[]} rows
 */
function requireWasmBinding(rows) {
  const hits = rows.filter((row) => WASM_BINDING.test(row.text));
  if (hits.length === 1) return;
  const suspect = hits[1] ?? hits[0];
  const line = suspect?.line ?? 0;
  const text = suspect?.text ?? "expected one `let wasmModule, wasm;` or `let wasm;`";
  throw ruleError("wasm binding", line, text);
}

/**
 * Rule 7. Replace the single glue URL fallback. Callers pass a compiled module.
 * @param {SourceRow[]} rows
 */
function replaceUrlFallback(rows) {
  /** @type {SourceRow[]} */
  const hits = [];
  for (const row of rows) {
    const parts = row.text.split(WASM_URL_ASSIGN);
    const count = parts.length - 1;
    if (count === 0) continue;
    if (count !== 1) {
      throw ruleError("module_or_path", row.line, row.text);
    }
    hits.push(row);
  }
  if (hits.length !== 1) {
    const suspect = hits[1] ?? hits[0];
    const line = suspect?.line ?? 0;
    const text = suspect?.text ?? "missing wasm url assignment";
    throw ruleError("module_or_path", line, text);
  }
  const row = hits[0];
  if (!row) throw ruleError("module_or_path", 0, "missing wasm url assignment");
  row.text = row.text.replace(WASM_URL_ASSIGN, LOAD_THROW);
}

/**
 * @param {string[]} names
 * @returns {string}
 */
function renderDts(names) {
  const members = names.map((name) => `  ${name}: typeof Glue.${name};`);
  members.push("  initSync: typeof Glue.initSync;");
  members.push("  init: typeof Glue.default;");
  return [
    'import type * as Glue from "./gwen_core.js";',
    "export declare const wasmUrl: URL;",
    "export declare const CONTRACT: { readonly fingerprint: string; readonly names: readonly string[]; readonly rawExports: readonly string[]; readonly imports: readonly string[] };",
    "export interface GwenCoreGlueInstance {",
    ...members,
    "}",
    "export declare function createGlue(): GwenCoreGlueInstance;",
    "",
  ].join("\n");
}

/**
 * Wrap one wasm-bindgen glue file.
 * @param {string} source
 * @param {GlueFactoryOptions} options
 * @returns {{ js: string, dts: string, contract: GlueContract }}
 */
export function transformGlue(source, options) {
  const opts = readOptions(options);
  // Rules 2–7 keep the original line number on each row.
  let rows = dropTail(sourceRows(source));
  const dropped = dropDevMarkers(rows);
  rows = dropped.rows;
  const names = collectNames(rows);
  rejectUnexpected(rows);
  requireWasmBinding(rows);
  replaceUrlFallback(rows);
  if (names.length === 0) {
    throw new Error("[wasm-factory] no exported API");
  }

  const body = rows.map((row) => row.text).join("\n");
  /** @type {GlueContract} */
  const contract = {
    fingerprint: opts.fingerprint,
    names,
    rawExports: rawExportNames(body),
    imports: importNames(body),
  };

  const contractLine = `export const CONTRACT = ${JSON.stringify(contract)};`;
  const opener = "export function createGlue() {";
  // Header, wasmUrl, CONTRACT, then the createGlue opener. The glue is the next line.
  const beforeGlue = [WASM_URL_LINE, contractLine, opener];
  const glueStart = beforeGlue.length + 2;
  const header = `// Generated by scripts/wasm-factory.mjs from ${opts.glueFile}; wasm-bindgen ${opts.wasmBindgenVersion}; wasm-bindgen output (MIT OR Apache-2.0). Lines of the glue start at line ${glueStart}.`;
  const rawGetter = dropped.exposeRaw ? ", get __wasm() { return wasm; }" : "";
  const returned = `return { ${names.join(", ")}, initSync, init: __wbg_init${rawGetter} };`;
  const js = [header, ...beforeGlue, body, returned, "}"].join("\n");
  const announced = js.split("\n")[glueStart - 1];
  if (rows.length > 0 && announced !== rows[0]?.text) {
    throw ruleError("header", glueStart, "glue body does not start at the announced line");
  }
  return { js: `${js}\n`, dts: renderDts(names), contract };
}

/**
 * `name = "wasm-bindgen"` then the next `version` line. Cargo.lock order.
 * @param {string} lockText
 * @returns {string}
 */
export function readWasmBindgenVersion(lockText) {
  const lines = lockText.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] !== 'name = "wasm-bindgen"') continue;
    for (let next = index + 1; next < lines.length; next += 1) {
      const version = /^version = "([^"]+)"/.exec(lines[next] ?? "");
      if (version?.[1]) return version[1];
      const row = lines[next] ?? "";
      if (row.startsWith("name = ") || row.startsWith("[[")) break;
    }
  }
  throw ruleError("wasm-bindgen version", 0, "Cargo.lock has no wasm-bindgen version");
}

/**
 * Rule 9. UTF-8 of the `gwen.fingerprint` custom section, or "" when absent.
 * @param {Buffer} wasmBytes
 * @returns {string}
 */
export function readFingerprint(wasmBytes) {
  const compiled = new WebAssembly.Module(wasmBytes);
  const sections = WebAssembly.Module.customSections(compiled, "gwen.fingerprint");
  if (sections.length === 0) return "";
  if (sections.length !== 1) {
    throw ruleError(
      "fingerprint",
      0,
      `expected one gwen.fingerprint section, found ${sections.length}`,
    );
  }
  const section = sections[0];
  if (!section) return "";
  return new TextDecoder().decode(section);
}

/**
 * @param {string} outDir
 */
function writeFactory(outDir) {
  const gluePath = path.join(outDir, "gwen_core.js");
  const declarationPath = path.join(outDir, "gwen_core.d.ts");
  const wasmPath = path.join(outDir, "gwen_core_bg.wasm");
  const glue = readFileSync(gluePath, "utf8");
  const declaration = readFileSync(declarationPath);
  if (declaration.length === 0) {
    throw ruleError("gwen_core.d.ts", 0, "empty declaration file");
  }
  const wasmBytes = readFileSync(wasmPath);
  const lockText = readFileSync(path.join(ROOT, "Cargo.lock"), "utf8");
  const result = transformGlue(glue, {
    variant: path.basename(outDir),
    glueFile: "gwen_core.js",
    wasmBindgenVersion: readWasmBindgenVersion(lockText),
    fingerprint: readFingerprint(wasmBytes),
  });
  writeFileSync(path.join(outDir, "gwen_core_factory.js"), result.js);
  writeFileSync(path.join(outDir, "gwen_core_factory.d.ts"), result.dts);
}

/**
 * @returns {boolean}
 */
function invokedAsCli() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function failCli(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runCli() {
  const outDir = process.argv[2];
  if (typeof outDir !== "string" || outDir.length === 0) {
    failCli("[wasm-factory] usage: line 0: node scripts/wasm-factory.mjs <out_dir>");
  }
  // Rule 1 runs before any file is opened.
  if (isRefusedOutDir(outDir)) {
    failCli(`[wasm-factory] refused output: line 0: ${outDir}`);
  }
  try {
    writeFactory(outDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failCli(message);
  }
}

if (invokedAsCli()) {
  runCli();
}
