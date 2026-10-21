#!/usr/bin/env node
/**
 * Check or write the public shape of `gwen_core_factory.js`.
 *
 *   node scripts/wasm-factory-golden.mjs [--check|--write] [--root <dir>]
 *
 * `--check` is the default. It compares Cargo.lock's wasm-bindgen version and
 * each variant's CONTRACT (names, rawExports, imports) with
 * `scripts/wasm-factory.golden.json`. `--write` rewrites that file from the
 * built factories, and only when rustc and wasm-pack match wasm-size.json.
 * No dependency.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const VARIANTS = ["light", "physics2d", "physics3d"];
const FIELDS = ["names", "rawExports", "imports"];

/**
 * @typedef {{ names: string[], rawExports: string[], imports: string[] }} Shape
 */

/**
 * Exact `name = "wasm-bindgen"` package, then its version line.
 * `wasm-bindgen-macro` and the other wasm-bindgen-* crates do not match.
 * @param {string} lockText
 * @returns {string | null}
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
  return null;
}

/**
 * @param {unknown} value
 * @returns {string[] | null}
 */
function stringList(value) {
  if (!Array.isArray(value)) return null;
  /** @type {string[]} */
  const out = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    out.push(item);
  }
  return out;
}

/**
 * @param {unknown} loaded
 * @returns {Shape | null}
 */
function readContract(loaded) {
  if (typeof loaded !== "object" || loaded === null || !("CONTRACT" in loaded)) return null;
  const contract = loaded.CONTRACT;
  if (typeof contract !== "object" || contract === null) return null;
  const names = "names" in contract ? stringList(contract.names) : null;
  const rawExports = "rawExports" in contract ? stringList(contract.rawExports) : null;
  const imports = "imports" in contract ? stringList(contract.imports) : null;
  if (!names || !rawExports || !imports) return null;
  return { names, rawExports, imports };
}

/**
 * Set difference, each side sorted. `plus` is in the build only.
 * @param {string[]} built
 * @param {string[]} golden
 * @returns {{ plus: string[], minus: string[] }}
 */
export function shapeDiff(built, golden) {
  const builtSet = new Set(built);
  const goldenSet = new Set(golden);
  const plus = [...builtSet].filter((item) => !goldenSet.has(item)).sort();
  const minus = [...goldenSet].filter((item) => !builtSet.has(item)).sort();
  return { plus, minus };
}

/**
 * @param {string} variant
 * @param {string} field
 * @param {string[]} built
 * @param {string[]} golden
 * @returns {string | null}
 */
function diffLine(variant, field, built, golden) {
  const { plus, minus } = shapeDiff(built, golden);
  if (plus.length === 0 && minus.length === 0) return null;
  return `[glue-shape] ${variant}.${field} differs: +[${plus.join(", ")}] -[${minus.join(", ")}]`;
}

/**
 * @param {string} variant
 * @returns {string}
 */
function factoryRel(variant) {
  return `packages/core/wasm/${variant}/gwen_core_factory.js`;
}

/**
 * @param {string} root
 * @param {string} variant
 * @returns {Promise<{ error: string } | { shape: Shape }>}
 */
async function loadShape(root, variant) {
  const rel = factoryRel(variant);
  const abs = path.join(root, rel);
  if (!existsSync(abs)) {
    return { error: `[glue-shape] ${rel} missing: run scripts/build-wasm.sh` };
  }
  let loaded;
  try {
    loaded = await import(pathToFileURL(abs));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `[glue-shape] ${rel} failed to load: ${message}` };
  }
  const shape = readContract(loaded);
  if (!shape) return { error: `[glue-shape] ${rel} has no CONTRACT` };
  return { shape };
}

/**
 * @param {unknown} variants
 * @param {string} name
 * @returns {Shape}
 */
function goldenShape(variants, name) {
  const empty = { names: [], rawExports: [], imports: [] };
  if (typeof variants !== "object" || variants === null || !(name in variants)) return empty;
  const row = Reflect.get(variants, name);
  if (typeof row !== "object" || row === null) return empty;
  return {
    names: ("names" in row ? stringList(row.names) : null) ?? [],
    rawExports: ("rawExports" in row ? stringList(row.rawExports) : null) ?? [],
    imports: ("imports" in row ? stringList(row.imports) : null) ?? [],
  };
}

/**
 * @param {string} root
 * @returns {{ wasmBindgen: string, variants: unknown } | { error: string }}
 */
function readGolden(root) {
  const rel = "scripts/wasm-factory.golden.json";
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return { error: `[glue-shape] ${rel} missing: run --write` };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(abs, "utf8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { error: `[glue-shape] ${rel} is not JSON: ${message}` };
  }
  if (typeof parsed !== "object" || parsed === null || !("wasmBindgen" in parsed)) {
    return { error: `[glue-shape] ${rel} has no wasmBindgen` };
  }
  if (typeof parsed.wasmBindgen !== "string") {
    return { error: `[glue-shape] ${rel} has no wasmBindgen` };
  }
  const variants = "variants" in parsed ? parsed.variants : null;
  return { wasmBindgen: parsed.wasmBindgen, variants };
}

/**
 * @param {string} text
 * @returns {string}
 */
function secondToken(text) {
  const line = text.trim().split("\n")[0] ?? "";
  return line.split(/\s+/)[1] ?? "";
}

/**
 * @param {string} command
 * @returns {string}
 */
function observedVersion(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  return secondToken(result.stdout ?? "");
}

/**
 * @param {string} root
 * @returns {{ rust: string, wasmPack: string }}
 */
function readPins(root) {
  const parsed = JSON.parse(readFileSync(path.join(root, "wasm-size.json"), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("toolchain" in parsed)) {
    throw new Error("[glue-shape] wasm-size.json has no toolchain");
  }
  const toolchain = parsed.toolchain;
  if (
    typeof toolchain !== "object" ||
    toolchain === null ||
    !("rust" in toolchain) ||
    !("wasmPack" in toolchain) ||
    typeof toolchain.rust !== "string" ||
    typeof toolchain.wasmPack !== "string"
  ) {
    throw new Error("[glue-shape] wasm-size.json toolchain is incomplete");
  }
  return { rust: toolchain.rust, wasmPack: toolchain.wasmPack };
}

/**
 * @param {string} root
 * @param {Record<string, Shape>} shapes
 * @param {string} wasmBindgen
 */
function writeGolden(root, shapes, wasmBindgen) {
  /** @type {Record<string, Shape>} */
  const variants = {};
  for (const variant of VARIANTS) {
    const shape = shapes[variant];
    if (!shape) continue;
    variants[variant] = {
      names: shape.names,
      rawExports: shape.rawExports,
      imports: shape.imports,
    };
  }
  const body = { wasmBindgen, variants };
  writeFileSync(
    path.join(root, "scripts/wasm-factory.golden.json"),
    `${JSON.stringify(body, null, 2)}\n`,
  );
}

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/**
 * @param {string[]} argv
 * @returns {{ mode: "check" | "write", root: string }}
 */
function parseArgs(argv) {
  /** @type {"check" | "write"} */
  let mode = "check";
  let root = ROOT;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--check") mode = "check";
    else if (arg === "--write") mode = "write";
    else if (arg === "--root") {
      const next = argv[index + 1];
      if (!next || next.startsWith("--")) fail("[glue-shape] --root needs a directory");
      index += 1;
      root = path.resolve(next);
    } else fail(`[glue-shape] unknown argument ${arg}`);
  }
  return { mode, root };
}

/**
 * @param {string} root
 * @returns {Promise<Record<string, Shape>>}
 */
async function loadShapes(root) {
  /** @type {string[]} */
  const errors = [];
  /** @type {Record<string, Shape>} */
  const shapes = {};
  for (const variant of VARIANTS) {
    const loaded = await loadShape(root, variant);
    if ("error" in loaded) errors.push(loaded.error);
    else shapes[variant] = loaded.shape;
  }
  if (errors.length > 0) fail(errors.join("\n"));
  return shapes;
}

/**
 * @param {string} root
 */
function lockVersion(root) {
  const lockPath = path.join(root, "Cargo.lock");
  if (!existsSync(lockPath)) fail("[glue-shape] Cargo.lock missing: run scripts/build-wasm.sh");
  const version = readWasmBindgenVersion(readFileSync(lockPath, "utf8"));
  if (!version) fail("[glue-shape] Cargo.lock has no wasm-bindgen version");
  return version;
}

/**
 * @param {string} root
 */
async function check(root) {
  /** @type {string[]} */
  const diffs = [];
  /** @type {Record<string, Shape>} */
  const shapes = {};
  for (const variant of VARIANTS) {
    const loaded = await loadShape(root, variant);
    if ("error" in loaded) diffs.push(loaded.error);
    else shapes[variant] = loaded.shape;
  }
  const version = (() => {
    const lockPath = path.join(root, "Cargo.lock");
    if (!existsSync(lockPath)) return null;
    return readWasmBindgenVersion(readFileSync(lockPath, "utf8"));
  })();
  const golden = readGolden(root);
  if ("error" in golden) diffs.push(golden.error);
  else if (!version) diffs.push("[glue-shape] Cargo.lock has no wasm-bindgen version");
  else if (version !== golden.wasmBindgen) {
    diffs.push(
      `[glue-shape] Cargo.lock wasm-bindgen ${version} != golden ${golden.wasmBindgen}: rebuild with scripts/build-wasm.sh and run --write`,
    );
  }
  if (!("error" in golden)) {
    for (const variant of VARIANTS) {
      const shape = shapes[variant];
      if (!shape) continue;
      const expected = goldenShape(golden.variants, variant);
      for (const field of FIELDS) {
        const line = diffLine(variant, field, shape[field], expected[field]);
        if (line) diffs.push(line);
      }
    }
  }
  if (diffs.length > 0) fail(diffs.join("\n"));
  process.stdout.write("[glue-shape] ok\n");
}

/**
 * @param {string} root
 */
async function write(root) {
  const pins = readPins(root);
  const foundRust = observedVersion("rustc");
  const foundPack = observedVersion("wasm-pack");
  if (foundRust !== pins.rust || foundPack !== pins.wasmPack) {
    fail(
      `[glue-shape] --write needs rustc ${pins.rust} and wasm-pack ${pins.wasmPack} (found rustc ${foundRust}, wasm-pack ${foundPack}): the golden is generated with the pinned toolchain, never by hand`,
    );
  }
  const shapes = await loadShapes(root);
  writeGolden(root, shapes, lockVersion(root));
}

async function main() {
  const { mode, root } = parseArgs(process.argv.slice(2));
  if (mode === "write") await write(root);
  else await check(root);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
  });
}
