import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { afterEach } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const live = new Set();
const WASM = Buffer.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);
const VARIANTS = ["physics2d", "physics3d"];

/**
 * @param {string[]} logA
 * @param {string[]} logB
 * @returns {string[]}
 */
function asymmetries(logA, logB) {
  /** @type {string[]} */
  const diffs = [];
  const n = Math.max(logA.length, logB.length);
  for (let i = 0; i < n; i++) {
    const a = logA[i];
    const b = logB[i];
    if (a !== b) diffs.push(`index ${i}: A ${a ?? "missing"} vs B ${b ?? "missing"}`);
  }
  return diffs;
}

/** @param {string} variant */
function stubJs(variant) {
  return `import fs from "node:fs";
const V = ${JSON.stringify(variant)};
const ordKey = "__detOrd_" + V;
let inits = 0;
const log = (o, m) => fs.appendFileSync(process.env.DET_CALL_LOG, V + "\\t" + o + "\\t" + m + "\\n");
const floats = (steps) => new Float32Array([steps, steps, 0, 0]);
export class Engine {
  constructor() {
    this.o = globalThis[ordKey] = (globalThis[ordKey] ?? 0) + 1;
    this.steps = 0;
    this.n = 0;
  }
  m(name) { log(this.o, name); }
  create_entity() { this.m("create_entity"); return { index: ++this.n }; }
  physics_init() { this.m("physics_init"); }
  physics_add_rigid_body() { this.m("physics_add_rigid_body"); }
  physics_add_box_collider() { this.m("physics_add_box_collider"); }
  physics_add_ball_collider() { this.m("physics_add_ball_collider"); }
  physics_apply_impulse() { this.m("physics_apply_impulse"); }
  physics_step() { this.m("physics_step"); this.steps += 1; }
  physics_get_position() { this.m("physics_get_position"); return floats(this.steps); }
  physics_get_linear_velocity() { this.m("physics_get_linear_velocity"); return floats(this.steps); }
  physics3d_init() { this.m("physics3d_init"); }
  physics3d_add_body() { this.m("physics3d_add_body"); }
  physics3d_add_box_collider() { this.m("physics3d_add_box_collider"); }
  physics3d_add_sphere_collider() { this.m("physics3d_add_sphere_collider"); }
  physics3d_set_linear_velocity() { this.m("physics3d_set_linear_velocity"); }
  physics3d_step() { this.m("physics3d_step"); this.steps += 1; }
  physics3d_get_body_state() { this.m("physics3d_get_body_state"); return floats(this.steps); }
}
export function initSync() {
  inits += 1;
  const buf = new ArrayBuffer(16);
  if (process.env.DET_DIVERGE_MEM === "1" && inits === 2) new Uint8Array(buf)[0] = 1;
  return { memory: { buffer: buf } };
}
export function createGlue() {
  return { initSync, Engine };
}
`;
}

function stage() {
  const dir = mkdtempSync(join(tmpdir(), "wasm-det-"));
  live.add(dir);
  copyFileSync(join(here, "det.mjs"), join(dir, "det.mjs"));
  writeFileSync(join(dir, "package.json"), '{"type":"module"}\n');
  for (const variant of VARIANTS) {
    const folder = join(dir, variant);
    mkdirSync(folder);
    writeFileSync(join(folder, "gwen_core_bg.wasm"), WASM);
    const js = stubJs(variant);
    writeFileSync(join(folder, "gwen_core_factory.js"), js);
    writeFileSync(join(folder, "gwen_core.js"), js);
  }
  return dir;
}

/** @param {string} dir */
function release(dir) {
  rmSync(dir, { recursive: true, force: true });
  live.delete(dir);
}

afterEach(() => {
  for (const dir of live) release(dir);
});

/**
 * @param {string} text
 * @returns {Record<string, Record<number, string[]>>}
 */
function sequences(text) {
  /** @type {Record<string, Record<number, string[]>>} */
  const out = { physics2d: {}, physics3d: {} };
  for (const line of text.split("\n")) {
    if (line === "") continue;
    const [variant, ord, method] = line.split("\t");
    const n = Number(ord);
    (out[variant][n] ??= []).push(method);
  }
  return out;
}

/**
 * @param {string} dir
 * @param {boolean} diverge
 */
function runDet(dir, diverge) {
  const logPath = join(dir, "calls.log");
  const result = spawnSync(process.execPath, ["det.mjs"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      DET_CALL_LOG: logPath,
      DET_DIVERGE_MEM: diverge ? "1" : "0",
    },
  });
  assert.equal(result.status, 0, result.stderr);
  return { json: JSON.parse(result.stdout), calls: readFileSync(logPath, "utf8") };
}

/** @param {string} dir */
function injectExtraStateOnA(dir) {
  const path = join(dir, "det.mjs");
  const text = readFileSync(path, "utf8");
  const anchor = "\n  sha(B.state());\n";
  assert.equal(text.split(anchor).length - 1, 1, "case (b) anchor sha(B.state()); occurs once");
  writeFileSync(path, text.replace(anchor, `${anchor}  A.state();\n`));
}

/** @param {Record<string, unknown>} block */
function stateHashes(block) {
  return [
    block.A_alone,
    block.B_alone,
    block.C_interleaved,
    block.D_interleaved,
    block.shared_singleton,
    block.shared_two_e1,
    block.shared_two_e2,
  ];
}

const EXTRA_STATE_FIRST = {
  physics2d: "index 244: A physics_get_position vs B physics_apply_impulse",
  physics3d: "index 196: A physics3d_get_body_state vs B physics3d_set_linear_velocity",
};

test("det.mjs gives instances A and B the same call sequence (physics2d and physics3d)", () => {
  const repeated = ["physics_get_position", "physics_step"];
  assert.deepEqual(asymmetries([], []), [], "case (c) zero calls before simulation on both sides");
  assert.deepEqual(asymmetries(repeated, repeated), [], "case (c) identical non-empty sequences");

  const sameDir = stage();
  const extraDir = stage();
  const diffDir = stage();
  try {
    const same = runDet(sameDir, false);
    const seqs = sequences(same.calls);
    for (const variant of VARIANTS) {
      const a = seqs[variant][1];
      const b = seqs[variant][2];
      assert.equal(Array.isArray(a), true, `case (a) ${variant} instance A`);
      assert.equal(Array.isArray(b), true, `case (a) ${variant} instance B`);
      const diff = asymmetries(a, b);
      assert.deepEqual(diff, [], `case (a) ${variant} ${diff[0] ?? ""}`);
    }

    injectExtraStateOnA(extraDir);
    const extra = sequences(runDet(extraDir, false).calls);
    for (const variant of VARIANTS) {
      const diff = asymmetries(extra[variant][1], extra[variant][2]);
      assert.equal(diff.length > 0, true, `case (b) ${variant} extra state() on A only`);
      assert.equal(diff[0], EXTRA_STATE_FIRST[variant], `case (b) ${variant} first asymmetry`);
    }

    for (const variant of VARIANTS) {
      const block = same.json[variant];
      assert.equal(block.mem_A, block.mem_B, `case (d) ${variant} mem_A === mem_B`);
      assert.equal(block.all_equal, true, `case (d) ${variant} identical memory all_equal`);
    }
    const diverged = runDet(diffDir, true);
    for (const variant of VARIANTS) {
      const block = diverged.json[variant];
      const hashes = stateHashes(block);
      assert.deepEqual(hashes, Array(7).fill(hashes[0]), `case (d) ${variant} state hashes equal`);
      assert.equal(block.mem_A === block.mem_B, false, `case (d) ${variant} memory differs`);
      assert.equal(
        block.all_equal,
        false,
        `case (d) ${variant} all_equal false when only memory differs`,
      );
    }
  } finally {
    release(sameDir);
    release(extraDir);
    release(diffDir);
  }
});
