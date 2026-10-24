import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const scriptPath = join(dirname(fileURLToPath(import.meta.url)), "wasm-build-id.mjs");

/** @param {number[]} values */
function bytes(values) {
  return Uint8Array.from(values);
}

function emptyModule() {
  return bytes([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
}

/** Minimal module. Export `answer` returns i32 42. */
function answerModule() {
  return bytes([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7f, 0x03,
    0x02, 0x01, 0x00, 0x07, 0x0a, 0x01, 0x06, 0x61, 0x6e, 0x73, 0x77, 0x65, 0x72, 0x00, 0x00, 0x0a,
    0x06, 0x01, 0x04, 0x00, 0x41, 0x2a, 0x0b,
  ]);
}

async function loadStamp() {
  return import("./wasm-build-id.mjs");
}

/**
 * @param {Uint8Array} wasm
 * @param {string} name
 * @returns {Uint8Array[]}
 */
function sections(wasm, name) {
  const compiled = new WebAssembly.Module(wasm);
  return WebAssembly.Module.customSections(compiled, name).map(
    (section) => new Uint8Array(section),
  );
}

test("stamping appends exactly one gwen.build section", async () => {
  const { stampBuildId } = await loadStamp();
  const input = emptyModule();
  const stamped = stampBuildId(input);
  const found = sections(stamped.bytes, "gwen.build");
  assert.equal(found.length, 1);
  assert.equal(new TextDecoder().decode(found[0]), stamped.id);
});

test("the id is the sha256 of the unstamped bytes", async () => {
  const { stampBuildId } = await loadStamp();
  const input = emptyModule();
  const stamped = stampBuildId(input);
  const ofInput = createHash("sha256").update(input).digest("hex");
  const ofStamped = createHash("sha256").update(stamped.bytes).digest("hex");
  assert.equal(stamped.id, ofInput);
  assert.equal(stamped.id.length, 64);
  assert.notEqual(stamped.id, ofStamped);
});

test("the stamped binary still compiles and runs", async () => {
  const { stampBuildId } = await loadStamp();
  const stamped = stampBuildId(answerModule());
  let value = 0;
  try {
    const instance = new WebAssembly.Instance(new WebAssembly.Module(stamped.bytes));
    const answer = instance.exports.answer;
    if (typeof answer === "function") value = Number(answer());
  } catch {
    value = 0;
  }
  assert.equal(value, 42);
});

test("stamping twice is refused", async () => {
  const { stampBuildId } = await loadStamp();
  const once = stampBuildId(emptyModule());
  assert.throws(() => stampBuildId(once.bytes), { message: "[wasm-build-id] already stamped" });
});

test("a non-wasm file is refused", async () => {
  const { stampBuildId } = await loadStamp();
  const message = "[wasm-build-id] not a wasm binary";
  assert.throws(() => stampBuildId(Buffer.from("nope")), { message });
  assert.throws(() => stampBuildId(Buffer.alloc(0)), { message });
});

test("a wasm binary with the wrong version is refused", async () => {
  const { stampBuildId } = await loadStamp();
  const message = "[wasm-build-id] not a wasm binary";
  const wrongVersion = bytes([0x00, 0x61, 0x73, 0x6d, 0x02, 0x00, 0x00, 0x00]);
  assert.throws(() => stampBuildId(wrongVersion), { message });
});

test("a magic-only header is refused", async () => {
  const { stampBuildId } = await loadStamp();
  const message = "[wasm-build-id] not a wasm binary";
  assert.throws(() => stampBuildId(bytes([0x00, 0x61, 0x73, 0x6d])), { message });
});

test("a truncated body after a valid header is refused", async () => {
  const { stampBuildId } = await loadStamp();
  const message = "[wasm-build-id] not a wasm binary";
  const truncated = bytes([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01]);
  assert.throws(() => stampBuildId(truncated), { message });
});

test("a long payload gets a two-byte size", async () => {
  const { appendCustomSection } = await loadStamp();
  const input = emptyModule();
  const name = "wide-name";
  const payload = new Uint8Array(200).fill(7);
  const stamped = appendCustomSection(input, name, payload);
  // Content size 210 = 1 (name length) + 9 ("wide-name") + 200. LEB128 is d2 01.
  const nameBytes = [0x77, 0x69, 0x64, 0x65, 0x2d, 0x6e, 0x61, 0x6d, 0x65];
  const suffix = [...stamped.slice(input.length)];
  assert.deepEqual(suffix, [0, 0xd2, 0x01, 0x09, ...nameBytes, ...payload]);
  const found = sections(stamped, name);
  assert.equal(found.length, 1);
  assert.deepEqual([...found[0]], [...payload]);
});

test("the size boundary 127/128 and the empty payload encode correctly", async () => {
  const { appendCustomSection } = await loadStamp();
  const input = emptyModule();
  const name = "n";
  // Content size is 1 (name length) + 1 (name "n") + payload.
  const cases = [
    { payload: new Uint8Array(125).fill(1), size: [0x7f] },
    { payload: new Uint8Array(126).fill(2), size: [0x80, 0x01] },
    { payload: new Uint8Array(0), size: [0x02] },
  ];
  for (const row of cases) {
    const stamped = appendCustomSection(input, name, row.payload);
    const suffix = [...stamped.slice(input.length)];
    assert.deepEqual(suffix, [0, ...row.size, 0x01, 0x6e, ...row.payload]);
    const found = sections(stamped, name);
    assert.equal(found.length, 1);
    assert.deepEqual([...found[0]], [...row.payload]);
  }
});

test("a 128-byte name gets a two-byte name length", async () => {
  const { appendCustomSection } = await loadStamp();
  const input = emptyModule();
  const name = "a".repeat(128);
  const payload = Uint8Array.of(7);
  const stamped = appendCustomSection(input, name, payload);
  const nameBytes = Array.from({ length: 128 }, () => 0x61);
  // Content size 131 = 2 (name length) + 128 + 1. Name length 128 is 80 01.
  const suffix = [...stamped.slice(input.length)];
  assert.deepEqual(suffix, [0, 0x83, 0x01, 0x80, 0x01, ...nameBytes, 7]);
  const found = sections(stamped, name);
  assert.equal(found.length, 1);
  assert.deepEqual([...found[0]], [...payload]);
});

test("a content size of 16384 gets a three-byte size", async () => {
  const { appendCustomSection } = await loadStamp();
  const input = emptyModule();
  const payload = new Uint8Array(16382).fill(3);
  const stamped = appendCustomSection(input, "n", payload);
  // Content size 16384 = 1 (name length) + 1 ("n") + 16382. LEB128 is 80 80 01.
  const suffix = [...stamped.slice(input.length)];
  assert.deepEqual(suffix.slice(0, 6), [0, 0x80, 0x80, 0x01, 0x01, 0x6e]);
  assert.deepEqual(suffix.slice(6), [...payload]);
  const found = sections(stamped, "n");
  assert.equal(found.length, 1);
  assert.deepEqual([...found[0]], [...payload]);
});

test("the CLI rewrites the file, prints the id and exits 1 on refusal", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wasm-build-id-"));
  try {
    const filePath = join(dir, "mod.wasm");
    const input = emptyModule();
    writeFileSync(filePath, input);
    const first = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
    const expected = createHash("sha256").update(input).digest("hex");
    assert.equal(first.status, 0, first.stderr ?? "");
    assert.equal(first.stdout, `${expected}\n`);
    const found = sections(new Uint8Array(readFileSync(filePath)), "gwen.build");
    assert.equal(found.length, 1);
    assert.equal(new TextDecoder().decode(found[0]), expected);

    const second = spawnSync(process.execPath, [scriptPath, filePath], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.equal(second.stderr, "[wasm-build-id] already stamped\n");

    const badPath = join(dir, "nope.bin");
    writeFileSync(badPath, Buffer.from("nope"));
    const third = spawnSync(process.execPath, [scriptPath, badPath], { encoding: "utf8" });
    assert.equal(third.status, 1);
    assert.equal(third.stderr, "[wasm-build-id] not a wasm binary\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
