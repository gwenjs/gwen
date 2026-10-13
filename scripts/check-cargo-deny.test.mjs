import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Frozen allow-list. Unlicense is omitted: MIT covers byteorder and memchr. */
const ALLOWED_LICENSES = ["Apache-2.0", "MIT", "MPL-2.0", "Unicode-3.0", "Zlib"];

/** Advisories with no upgrade. The fixable crossbeam-epoch id is not here. */
const IGNORES = [
  {
    id: "RUSTSEC-2024-0436",
    reason: "paste 1.0.15 has no upgrade. #189. 2026-10-13.",
  },
  {
    id: "RUSTSEC-2025-0141",
    reason: "bincode 2.0.1 has no upgrade. #188. 2026-10-13.",
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

test("advisories with no upgrade are ignored with an issue and a date", () => {
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
  assert.match(job, /cargo deny --all-features check licenses advisories bans sources/);
  const status = jobBlock(yaml, "ci-status");
  assert.match(status, /(?:needs:\s*\[[^\]]*rust-deny|^\s+- rust-deny$)/m);
  assert.match(status, /needs\['rust-deny'\]\.result/);
});
