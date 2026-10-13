import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Frozen allow-list. Unlicense is omitted: MIT covers byteorder and memchr. */
const ALLOWED_LICENSES = ["Apache-2.0", "MIT", "MPL-2.0", "Unicode-3.0", "Zlib"];

/** Unmaintained, patched = []. The fixable crossbeam-epoch id is not here. */
const IGNORES = [
  {
    id: "RUSTSEC-2024-0436",
    reason:
      "paste 1.0.15 is informational unmaintained, patched = []. Proc-macro, compile time only. #189. 2026-10-13.",
  },
  {
    id: "RUSTSEC-2025-0141",
    reason:
      "bincode 2.0.1 is informational unmaintained, patched = []. Ships in the physics3d wasm. #188. 2026-10-13.",
  },
];

const CARGO_DENY_SHA256 = "9f12ed4c49936e09b48bf862b595cde2fe64fcbd9d74dfacac6131ca824c8d5f";

/**
 * @param {string} path
 * @returns {string}
 */
function readOrEmpty(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isEnoent(error)) return "";
    throw error;
  }
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isEnoent(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/**
 * @param {string} text
 * @param {string} name
 * @returns {string}
 */
function section(text, name) {
  const header = `[${name}]`;
  const start = text.indexOf(header);
  if (start === -1) return "";
  const rest = text.slice(start + header.length);
  const next = rest.search(/\n\[/);
  return next === -1 ? rest : rest.slice(0, next);
}

/**
 * @param {string} yaml
 * @param {string} id
 * @returns {string}
 */
function jobBlock(yaml, id) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.indexOf(`  ${id}:`);
  if (start === -1) return "";
  let end = start + 1;
  while (
    end < lines.length &&
    !/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[end] ?? "") &&
    !/^\S/.test(lines[end] ?? "")
  )
    end++;
  return lines.slice(start, end).join("\n");
}

/**
 * @param {string} version
 * @param {string} floor
 * @returns {boolean}
 */
function below(version, floor) {
  const left = version.split(".");
  const right = floor.split(".");
  for (let i = 0; i < 3; i++) {
    const a = Number(left[i]);
    const b = Number(right[i]);
    if (!Number.isInteger(a) || !Number.isInteger(b)) return true;
    if (a < b) return true;
    if (a > b) return false;
  }
  return false;
}

/** @typedef {{ id: string, reason: string | null }} IgnoreEntry */
/** @typedef {string | Array<string | IgnoreEntry>} DenyValue */
/** @typedef {{ ok: true, tables: Record<string, Record<string, DenyValue>> }} DenyOk */
/** @typedef {{ ok: false, error: string }} DenyErr */
/** @typedef {DenyOk | DenyErr} DenyParse */

/** Tables and keys this gate understands. Anything else fails closed. */
/** @type {Record<string, Record<string, "string" | "array">>} */
const DENY_KEYS = {
  advisories: {
    ignore: "array",
    unmaintained: "string",
    yanked: "string",
    vulnerability: "string",
    notice: "string",
  },
  licenses: { allow: "array" },
  bans: { "multiple-versions": "string" },
  sources: {
    "unknown-registry": "string",
    "unknown-git": "string",
    "allow-registry": "array",
    "allow-git": "array",
  },
  graph: { exclude: "array" },
};

const CRATES_IO = "https://github.com/rust-lang/crates.io-index";
const DENY_RUN = "cargo deny --all-features --locked check licenses advisories bans sources";

/**
 * @param {string} text
 * @returns {string | null}
 */
function parseQuoted(text) {
  const match = text.match(/^"([^"\\]*)"$/);
  if (!match) return null;
  return match[1] ?? "";
}

/**
 * @param {string} text
 * @returns {IgnoreEntry | null}
 */
function parseIgnoreEntry(text) {
  const withReason = text.match(/^\{ id = "([^"]+)", reason = "([^"]*)" \}$/);
  if (withReason) return { id: withReason[1] ?? "", reason: withReason[2] ?? "" };
  const idOnly = text.match(/^\{ id = "([^"]+)" \}$/);
  if (idOnly) return { id: idOnly[1] ?? "", reason: null };
  return null;
}

/**
 * @param {string} inner
 * @returns {Array<string | IgnoreEntry> | null}
 */
function parseInlineArray(inner) {
  const trimmed = inner.trim();
  if (trimmed === "") return [];
  /** @type {Array<string | IgnoreEntry>} */
  const items = [];
  for (const part of trimmed.split(",")) {
    const item = part.trim();
    if (item === "") continue;
    if (item.startsWith("{")) {
      const entry = parseIgnoreEntry(item);
      if (!entry) return null;
      items.push(entry);
      continue;
    }
    const quoted = parseQuoted(item);
    if (quoted === null) return null;
    items.push(quoted);
  }
  return items;
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ items: Array<string | IgnoreEntry>, next: number, error: string }}
 */
function parseMultilineArray(lines, start) {
  /** @type {Array<string | IgnoreEntry>} */
  const items = [];
  for (let i = start; i < lines.length; i++) {
    const item = (lines[i] ?? "").trim();
    if (item === "]") return { items, next: i, error: "" };
    if (item === "" || item.startsWith("#")) continue;
    const stripped = item.endsWith(",") ? item.slice(0, -1).trim() : item;
    if (stripped === "") continue;
    if (stripped.startsWith("{")) {
      const entry = parseIgnoreEntry(stripped);
      if (!entry) return { items, next: i, error: `not understood: ${stripped}` };
      items.push(entry);
      continue;
    }
    const quoted = parseQuoted(stripped);
    if (quoted === null) return { items, next: i, error: `not understood: ${stripped}` };
    items.push(quoted);
  }
  return { items, next: lines.length, error: "unclosed array" };
}

/**
 * @param {string} text
 * @returns {DenyParse}
 */
function parseDeny(text) {
  if (text.trim() === "") return { ok: false, error: "empty deny.toml" };
  /** @type {Record<string, Record<string, DenyValue>>} */
  const tables = {};
  let table = "";
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = (lines[i] ?? "").trim();
    if (line === "" || line.startsWith("#")) continue;
    const header = line.match(/^\[([a-z][a-z0-9-]*)\]$/);
    if (header) {
      table = header[1] ?? "";
      if (!Object.hasOwn(DENY_KEYS, table))
        return { ok: false, error: `not understood: [${table}]` };
      if (Object.hasOwn(tables, table)) return { ok: false, error: `duplicate table [${table}]` };
      tables[table] = {};
      continue;
    }
    if (table === "") return { ok: false, error: `not understood: ${line}` };
    const assigned = line.match(/^([a-z][a-z0-9-]*)\s*=\s*(.*)$/);
    if (!assigned) return { ok: false, error: `not understood: ${line}` };
    const key = assigned[1] ?? "";
    const rest = assigned[2] ?? "";
    const expected = DENY_KEYS[table]?.[key];
    if (!expected) return { ok: false, error: `not understood: ${table}.${key}` };
    const bucket = tables[table];
    if (!bucket) return { ok: false, error: `not understood: [${table}]` };
    if (Object.hasOwn(bucket, key)) return { ok: false, error: `duplicate key ${table}.${key}` };
    if (rest === "[") {
      const parsed = parseMultilineArray(lines, i + 1);
      if (parsed.error !== "") return { ok: false, error: parsed.error };
      i = parsed.next;
      if (expected !== "array") return { ok: false, error: `not understood: ${table}.${key}` };
      bucket[key] = parsed.items;
      continue;
    }
    if (rest.startsWith("[")) {
      if (!rest.endsWith("]")) return { ok: false, error: `not understood: ${line}` };
      if (expected !== "array") return { ok: false, error: `not understood: ${table}.${key}` };
      const items = parseInlineArray(rest.slice(1, -1));
      if (items === null) return { ok: false, error: `not understood: ${line}` };
      bucket[key] = items;
      continue;
    }
    if (expected !== "string") return { ok: false, error: `not understood: ${table}.${key}` };
    const value = parseQuoted(rest);
    if (value === null) return { ok: false, error: `not understood: ${line}` };
    bucket[key] = value;
  }
  return { ok: true, tables };
}

/**
 * @param {DenyParse} parsed
 * @returns {Record<string, Record<string, DenyValue>>}
 */
function parsedTables(parsed) {
  assert.equal(parsed.ok, true, parsed.ok ? "" : parsed.error);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.tables;
}

/**
 * @param {string | IgnoreEntry} entry
 * @returns {entry is IgnoreEntry}
 */
function isIgnoreEntry(entry) {
  return typeof entry === "object" && entry !== null && "reason" in entry;
}

/**
 * @typedef {{
 *   found: boolean,
 *   jobContinue: boolean,
 *   stepContinue: boolean,
 *   denyRun: string | null,
 *   checksumOk: boolean,
 *   checksumDetail: string,
 * }} DenyJobPolicy
 */

/**
 * @param {string} yaml
 * @returns {DenyJobPolicy}
 */
function rustDenyPolicy(yaml) {
  const block = jobBlock(yaml, "rust-deny");
  if (block === "") {
    return {
      found: false,
      jobContinue: false,
      stepContinue: false,
      denyRun: null,
      checksumOk: false,
      checksumDetail: "job missing",
    };
  }
  let jobContinue = false;
  let stepContinue = false;
  /** @type {string | null} */
  let denyRun = null;
  let checksums = 0;
  let checksumBad = false;
  let setPlusE = false;
  for (const line of block.split("\n")) {
    if (/^ {4}continue-on-error:\s*true\s*(?:#.*)?$/.test(line)) jobContinue = true;
    if (/^ {6}- continue-on-error:\s*true\s*(?:#.*)?$/.test(line)) stepContinue = true;
    if (/^ {8}continue-on-error:\s*true\s*(?:#.*)?$/.test(line)) stepContinue = true;
    const run = line.match(/^ {8}run:\s*(.*)$/);
    if (run) {
      const value = (run[1] ?? "").trim();
      if (value !== "|" && value !== "|-" && value !== ">" && value !== ">-") {
        if (value.includes("cargo deny")) denyRun = value;
      }
    }
    if (line.includes("set +e")) setPlusE = true;
    if (line.includes("sha256sum")) {
      checksums += 1;
      if (!line.includes("sha256sum -c") || line.includes("||")) checksumBad = true;
    }
  }
  let checksumDetail = "ok";
  if (setPlusE) checksumDetail = "set +e";
  else if (checksums === 0) checksumDetail = "no sha256sum -c";
  else if (checksumBad) checksumDetail = "sha256sum weakened";
  return {
    found: true,
    jobContinue,
    stepContinue,
    denyRun,
    checksumOk: checksums > 0 && !checksumBad && !setPlusE,
    checksumDetail,
  };
}

test("gwen-wasm-utils declares MPL-2.0", () => {
  const cargo = readOrEmpty(join(root, "crates/gwen-wasm-utils/Cargo.toml"));
  assert.match(cargo, /^license = "MPL-2\.0"$/m);
});

test("deny.toml allows exactly the five frozen licenses", () => {
  const licenses = section(readOrEmpty(join(root, "deny.toml")), "licenses");
  const allow = licenses.match(/allow\s*=\s*\[([\s\S]*?)\]/);
  const ids = [...(allow?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((match) => match[1] ?? "");
  assert.deepEqual(ids, ALLOWED_LICENSES);
});

test("ignored advisories cite an issue and a date", () => {
  const advisories = section(readOrEmpty(join(root, "deny.toml")), "advisories");
  const found = [...advisories.matchAll(/id = "([^"]+)", reason = "([^"]+)"/g)].map((match) => ({
    id: match[1] ?? "",
    reason: match[2] ?? "",
  }));
  assert.deepEqual(found, IGNORES);
});

test("crossbeam-epoch is at least 0.9.20", () => {
  const lock = readOrEmpty(join(root, "Cargo.lock"));
  const match = lock.match(/\[\[package\]\]\nname = "crossbeam-epoch"\nversion = "([^"]+)"/);
  assert.equal(below(match?.[1] ?? "0.0.0", "0.9.20"), false);
});

test("sources are crates.io only and duplicate versions warn", () => {
  const text = readOrEmpty(join(root, "deny.toml"));
  const sources = section(text, "sources");
  const bans = section(text, "bans");
  assert.match(sources, /unknown-registry = "deny"/);
  assert.match(sources, /unknown-git = "deny"/);
  assert.match(sources, /allow-git = \[\]/);
  assert.match(bans, /multiple-versions = "warn"/);
});

test("the cargo-deny job checks every kind and ci-status reads it", () => {
  const yaml = readOrEmpty(join(root, ".github/workflows/ci.yml"));
  const job = jobBlock(yaml, "rust-deny");
  assert.match(job, /name: cargo-deny/);
  assert.match(job, /timeout-minutes: 2/);
  assert.match(job, /toolchain: "1\.99\.0"/);
  assert.match(job, /cargo-deny-0\.20\.2-x86_64-unknown-linux-musl\.tar\.gz/);
  assert.match(job, new RegExp(CARGO_DENY_SHA256));
  assert.match(job, /sha256sum -c/);
  assert.match(job, /export PATH="\$dest:\$PATH"\n\s*cargo-deny --version/);
  assert.match(job, /cargo deny --all-features --locked check licenses advisories bans sources/);
  const status = jobBlock(yaml, "ci-status");
  assert.match(status, /(?:needs:\s*\[[^\]]*rust-deny|^\s+- rust-deny$)/m);
  assert.match(status, /needs\['rust-deny'\]\.result/);
});

test("continue-on-error on the cargo-deny job or a step fails", () => {
  const policy = rustDenyPolicy(readOrEmpty(join(root, ".github/workflows/ci.yml")));
  assert.equal(policy.found, true);
  assert.equal(policy.jobContinue, false);
  assert.equal(policy.stepContinue, false);
});

test("echo instead of cargo deny fails", () => {
  const policy = rustDenyPolicy(readOrEmpty(join(root, ".github/workflows/ci.yml")));
  assert.equal(policy.found, true);
  assert.equal(policy.denyRun, DENY_RUN);
});

test("sha256sum -c or true fails", () => {
  const policy = rustDenyPolicy(readOrEmpty(join(root, ".github/workflows/ci.yml")));
  assert.equal(policy.found, true);
  assert.equal(policy.checksumOk, true, policy.checksumDetail);
});

test("unmaintained none fails", () => {
  const tables = parsedTables(parseDeny(readOrEmpty(join(root, "deny.toml"))));
  const advisories = tables.advisories;
  assert.ok(advisories);
  const unmaintained = advisories.unmaintained;
  if (unmaintained !== undefined) assert.equal(unmaintained, "all");
  assert.equal(advisories.vulnerability, undefined);
  assert.equal(advisories.notice, undefined);
});

test("yanked allow fails", () => {
  const tables = parsedTables(parseDeny(readOrEmpty(join(root, "deny.toml"))));
  const yanked = tables.advisories?.yanked;
  assert.notEqual(yanked, "allow");
  if (yanked !== undefined) assert.ok(yanked === "warn" || yanked === "deny");
});

test("a graph exclude hides crates from the check", () => {
  const tables = parsedTables(parseDeny(readOrEmpty(join(root, "deny.toml"))));
  const exclude = tables.graph?.exclude;
  const list = Array.isArray(exclude) ? exclude : [];
  assert.deepEqual(list, []);
});

test("allow-registry other than crates.io fails", () => {
  const tables = parsedTables(parseDeny(readOrEmpty(join(root, "deny.toml"))));
  const sources = tables.sources;
  assert.ok(sources);
  assert.deepEqual(sources["allow-registry"], [CRATES_IO]);
  assert.equal(sources["unknown-registry"], "deny");
  assert.equal(sources["unknown-git"], "deny");
});

test("a bare-string ignore without issue and date fails", () => {
  const tables = parsedTables(parseDeny(readOrEmpty(join(root, "deny.toml"))));
  const ignore = tables.advisories?.ignore;
  assert.ok(Array.isArray(ignore));
  assert.ok(ignore.length > 0);
  for (const entry of ignore) {
    assert.equal(isIgnoreEntry(entry), true);
    if (!isIgnoreEntry(entry)) continue;
    assert.equal(typeof entry.reason, "string");
    assert.match(entry.reason ?? "", /#\d+/);
    assert.match(entry.reason ?? "", /\d{4}-\d{2}-\d{2}/);
  }
});
