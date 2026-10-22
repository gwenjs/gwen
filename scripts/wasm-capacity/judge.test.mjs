import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test, { afterEach } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtures = join(here, "fixtures");
const judge = join(here, "judge.mjs");
const live = new Set();

const SHARED_CHECKS = [
  "vm_per_instance_le_10_1_gib",
  "ceiling_error_is_typed_range_error",
  "ulimit_16_32_64_formula_pm1",
  "room_cost_le_2ms_1mib_light",
  "room_cost_le_2ms_1mib_physics2d",
  "room_cost_le_2ms_1mib_physics3d",
  "determinism_equal_modes",
  "dropped_3000_rooms_reclaimed_under_64gib",
  "notrap_with_limit_exit_134_recorded",
];

/**
 * @param {string} pass
 * @param {string} [overlay]
 */
function stage(pass, overlay) {
  const dir = mkdtempSync(join(tmpdir(), "wasm-capacity-"));
  live.add(dir);
  cpSync(join(fixtures, pass), dir, { recursive: true });
  if (overlay) cpSync(join(fixtures, overlay), dir, { recursive: true });
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

/** @param {string} dir */
function run(dir) {
  const result = spawnSync(process.execPath, [judge, dir], { encoding: "utf8" });
  /** @type {{ arch?: string, metrics?: Record<string, unknown>, checks?: Record<string, { ok?: boolean, measured?: unknown, threshold?: unknown }> } | null} */
  let json = null;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    json = null;
  }
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, json };
}

/**
 * @param {{ checks?: Record<string, { ok?: boolean }> } | null} json
 */
function failedNames(json) {
  return Object.entries(json?.checks ?? {})
    .filter(([, check]) => check?.ok !== true)
    .map(([name]) => name);
}

/**
 * @param {string} arch
 */
function expectedNames(arch) {
  return [...SHARED_CHECKS, `${arch}_ceiling_ge_12000`].sort();
}

/**
 * @param {string} dir
 * @param {string} arch
 */
function assertPass(dir, arch) {
  const result = run(dir);
  assert.equal(result.json?.checks?.vm_per_instance_le_10_1_gib?.ok, true);
  assert.equal(result.json?.checks?.[`${arch}_ceiling_ge_12000`]?.ok, true);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(Object.keys(result.json?.checks ?? {}).sort(), expectedNames(arch));
  assert.deepEqual(failedNames(result.json), []);
  return result;
}

/**
 * @param {string} dir
 * @param {string} name
 * @param {string} arch
 */
function assertFailedOnly(dir, name, arch) {
  const result = run(dir);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.ok(result.json, result.stderr);
  assert.equal(result.json.checks?.[name]?.ok, false);
  assert.deepEqual(Object.keys(result.json.checks ?? {}).sort(), expectedNames(arch));
  assert.deepEqual(failedNames(result.json), [name]);
  return result;
}

/**
 * @param {string} dir
 * @param {string} file
 * @param {(json: Record<string, unknown>) => void} edit
 */
function patchOut(dir, file, edit) {
  const path = join(dir, file);
  const line = readFileSync(path, "utf8").trim().split("\n").pop() ?? "";
  const json = JSON.parse(line);
  edit(json);
  writeFileSync(path, `${JSON.stringify(json)}\n`);
  return json;
}

/**
 * @param {string} dir
 * @param {"physics2d" | "physics3d"} mode
 * @param {"all_equal" | "moved"} field
 */
function setDetFlag(dir, mode, field) {
  patchOut(dir, "det.out", (json) => {
    const block = json[mode];
    if (!block || typeof block !== "object" || Array.isArray(block)) {
      throw new Error(`missing ${mode}`);
    }
    Object.assign(block, { [field]: false });
  });
}

test("a passing results dir exits 0", () => {
  for (const arch of ["x64", "arm64"]) {
    const dir = stage(`pass-${arch}`);
    try {
      const result = assertPass(dir, arch);
      assert.equal(result.json?.arch, arch);
      assert.equal(result.json?.metrics && result.json.metrics["unlimited"]?.failed_at, 24147);
    } finally {
      release(dir);
    }
  }
});

test("x64 ceiling 11000 exits 1 and names x64_ceiling_ge_12000", () => {
  const dir = stage("pass-x64", "x64-ceiling-11000");
  try {
    const result = assertFailedOnly(dir, "x64_ceiling_ge_12000", "x64");
    assert.equal(result.json?.checks?.x64_ceiling_ge_12000?.measured, 11000);
    assert.equal(result.json?.checks?.x64_ceiling_ge_12000?.threshold, 12000);
  } finally {
    release(dir);
  }
});

test("x64 ceiling exactly 12000 exits 0", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "unl-default.out", (json) => {
      json.failed_at = 12000;
      json.held = 11999;
    });
    const result = assertPass(dir, "x64");
    assert.equal(result.json?.checks?.x64_ceiling_ge_12000?.measured, 12000);
    assert.equal(result.json?.checks?.x64_ceiling_ge_12000?.threshold, 12000);
  } finally {
    release(dir);
  }
});

test("vm per instance exactly 10.1 exits 0", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "unl-default.out", (json) => {
      json.vm_per_inst_gib_avg = 10.1;
    });
    const result = assertPass(dir, "x64");
    assert.equal(result.json?.checks?.vm_per_instance_le_10_1_gib?.measured, 10.1);
  } finally {
    release(dir);
  }
});

test("vm per instance above 10.1 exits 1 and names vm_per_instance_le_10_1_gib", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "unl-default.out", (json) => {
      json.vm_per_inst_gib_avg = 10.11;
    });
    const result = assertFailedOnly(dir, "vm_per_instance_le_10_1_gib", "x64");
    assert.equal(result.json?.checks?.vm_per_instance_le_10_1_gib?.measured, 10.11);
    assert.equal(result.json?.checks?.vm_per_instance_le_10_1_gib?.threshold, 10.1);
  } finally {
    release(dir);
  }
});

test("room cost exactly 2.0 ms and 1.0 MiB exits 0", () => {
  const dir = stage("pass-x64");
  try {
    for (const variant of ["light", "physics2d", "physics3d"]) {
      patchOut(dir, `start-${variant}.out`, (json) => {
        json.ms_per_room = 2.0;
        json.rss_per_room_mib = 1.0;
      });
    }
    const result = assertPass(dir, "x64");
    assert.equal(result.json?.checks?.room_cost_le_2ms_1mib_light?.ok, true);
  } finally {
    release(dir);
  }
});

test("room cost above 2.0 ms exits 1 and names room_cost_le_2ms_1mib_light", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "start-light.out", (json) => {
      json.ms_per_room = 2.01;
    });
    assertFailedOnly(dir, "room_cost_le_2ms_1mib_light", "x64");
  } finally {
    release(dir);
  }
});

test("room cost above 1.0 MiB exits 1 and names room_cost_le_2ms_1mib_light", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "start-light.out", (json) => {
      json.rss_per_room_mib = 1.01;
    });
    assertFailedOnly(dir, "room_cost_le_2ms_1mib_light", "x64");
  } finally {
    release(dir);
  }
});

test("ulimit failed_at one off the formula exits 0", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "ul16-default.out", (json) => {
      const base = Number(json.base_vm_gib);
      const expect = Math.floor((16 - base) / 10) + 1;
      json.failed_at = expect + 1;
    });
    assertPass(dir, "x64");
  } finally {
    release(dir);
  }
});

test("notrap exit codes other than 134 stay ok when recorded", () => {
  const dir = stage("pass-x64");
  try {
    for (const limit of [16, 32, 64]) writeFileSync(join(dir, `ul${limit}-notrap.code`), "139\n");
    const result = assertPass(dir, "x64");
    assert.deepEqual(result.json?.checks?.notrap_with_limit_exit_134_recorded?.measured, {
      16: 139,
      32: 139,
      64: 139,
    });
  } finally {
    release(dir);
  }
});

test("a missing results file fails its check instead of crashing", () => {
  const dir = stage("pass-x64");
  try {
    rmSync(join(dir, "leak64.out"));
    const result = assertFailedOnly(dir, "dropped_3000_rooms_reclaimed_under_64gib", "x64");
    assert.equal(result.json?.checks?.dropped_3000_rooms_reclaimed_under_64gib?.measured, null);
  } finally {
    release(dir);
  }
});

test("vm_per_instance_le_10_1_gib failing fixture exits 1 and names vm_per_instance_le_10_1_gib", () => {
  const dir = stage("pass-x64", "vm_per_instance_le_10_1_gib");
  try {
    assertFailedOnly(dir, "vm_per_instance_le_10_1_gib", "x64");
  } finally {
    release(dir);
  }
});

test("arm64_ceiling_ge_12000 failing fixture exits 1 and names arm64_ceiling_ge_12000", () => {
  const dir = stage("pass-arm64", "arm64_ceiling_ge_12000");
  try {
    const result = assertFailedOnly(dir, "arm64_ceiling_ge_12000", "arm64");
    assert.equal(result.json?.checks?.arm64_ceiling_ge_12000?.measured, 11000);
    assert.equal(result.json?.checks?.arm64_ceiling_ge_12000?.threshold, 12000);
  } finally {
    release(dir);
  }
});

test("ceiling_error_is_typed_range_error failing fixture exits 1 and names ceiling_error_is_typed_range_error", () => {
  const dir = stage("pass-x64", "ceiling_error_is_typed_range_error");
  try {
    assertFailedOnly(dir, "ceiling_error_is_typed_range_error", "x64");
  } finally {
    release(dir);
  }
});

test("ulimit_16_32_64_formula_pm1 failing fixture exits 1 and names ulimit_16_32_64_formula_pm1", () => {
  const dir = stage("pass-x64", "ulimit_16_32_64_formula_pm1");
  try {
    assertFailedOnly(dir, "ulimit_16_32_64_formula_pm1", "x64");
  } finally {
    release(dir);
  }
});

test("room_cost_le_2ms_1mib_light failing fixture exits 1 and names room_cost_le_2ms_1mib_light", () => {
  const dir = stage("pass-x64", "room_cost_le_2ms_1mib_light");
  try {
    assertFailedOnly(dir, "room_cost_le_2ms_1mib_light", "x64");
  } finally {
    release(dir);
  }
});

test("room_cost_le_2ms_1mib_physics2d failing fixture exits 1 and names room_cost_le_2ms_1mib_physics2d", () => {
  const dir = stage("pass-x64", "room_cost_le_2ms_1mib_physics2d");
  try {
    assertFailedOnly(dir, "room_cost_le_2ms_1mib_physics2d", "x64");
  } finally {
    release(dir);
  }
});

test("room_cost_le_2ms_1mib_physics3d failing fixture exits 1 and names room_cost_le_2ms_1mib_physics3d", () => {
  const dir = stage("pass-x64", "room_cost_le_2ms_1mib_physics3d");
  try {
    assertFailedOnly(dir, "room_cost_le_2ms_1mib_physics3d", "x64");
  } finally {
    release(dir);
  }
});

test("determinism_equal_modes failing fixture exits 1 and names determinism_equal_modes", () => {
  const dir = stage("pass-x64", "determinism_equal_modes");
  try {
    assertFailedOnly(dir, "determinism_equal_modes", "x64");
  } finally {
    release(dir);
  }
});

test("dropped_3000_rooms_reclaimed_under_64gib failing fixture exits 1 and names dropped_3000_rooms_reclaimed_under_64gib", () => {
  const dir = stage("pass-x64", "dropped_3000_rooms_reclaimed_under_64gib");
  try {
    assertFailedOnly(dir, "dropped_3000_rooms_reclaimed_under_64gib", "x64");
  } finally {
    release(dir);
  }
});

test("notrap_with_limit_exit_134_recorded failing fixture exits 1 and names notrap_with_limit_exit_134_recorded", () => {
  const dir = stage("pass-x64", "notrap_with_limit_exit_134_recorded");
  try {
    assertFailedOnly(dir, "notrap_with_limit_exit_134_recorded", "x64");
  } finally {
    release(dir);
  }
});

test("ceiling process exit code other than 0 exits 1 and names ceiling_error_is_typed_range_error", () => {
  const dir = stage("pass-x64");
  try {
    writeFileSync(join(dir, "unl-default.code"), "134\n");
    assertFailedOnly(dir, "ceiling_error_is_typed_range_error", "x64");
  } finally {
    release(dir);
  }
});

test("ul32 non-typed error exits 1 and names ulimit_16_32_64_formula_pm1", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "ul32-default.out", (json) => {
      json.error = "Error: not a typed RangeError";
    });
    assertFailedOnly(dir, "ulimit_16_32_64_formula_pm1", "x64");
  } finally {
    release(dir);
  }
});

test("missing base_vm_gib exits 1 and names ulimit_16_32_64_formula_pm1", () => {
  const dir = stage("pass-x64");
  try {
    patchOut(dir, "ul32-default.out", (json) => {
      delete json.base_vm_gib;
    });
    assertFailedOnly(dir, "ulimit_16_32_64_formula_pm1", "x64");
  } finally {
    release(dir);
  }
});

test("physics3d all_equal false exits 1 and names determinism_equal_modes", () => {
  const dir = stage("pass-x64");
  try {
    setDetFlag(dir, "physics3d", "all_equal");
    assertFailedOnly(dir, "determinism_equal_modes", "x64");
  } finally {
    release(dir);
  }
});

test("physics2d moved false exits 1 and names determinism_equal_modes", () => {
  const dir = stage("pass-x64");
  try {
    setDetFlag(dir, "physics2d", "moved");
    assertFailedOnly(dir, "determinism_equal_modes", "x64");
  } finally {
    release(dir);
  }
});

test("physics3d moved false exits 1 and names determinism_equal_modes", () => {
  const dir = stage("pass-x64");
  try {
    setDetFlag(dir, "physics3d", "moved");
    assertFailedOnly(dir, "determinism_equal_modes", "x64");
  } finally {
    release(dir);
  }
});

test("arch other than x64 or arm64 exits 1", () => {
  const dir = stage("pass-x64");
  try {
    writeFileSync(join(dir, "arch.txt"), "ia32\n");
    const result = run(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.json, null);
    assert.match(result.stderr, /ia32/);
    assert.match(result.stderr, /x64/);
    assert.match(result.stderr, /arm64/);
  } finally {
    release(dir);
  }
});

test("empty arch.txt exits 1", () => {
  const dir = stage("pass-x64");
  try {
    writeFileSync(join(dir, "arch.txt"), "\n");
    const result = run(dir);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.json, null);
  } finally {
    release(dir);
  }
});

test("missing arch.txt uses process.arch", () => {
  const dir = stage("pass-x64");
  try {
    rmSync(join(dir, "arch.txt"));
    const result = assertPass(dir, process.arch);
    assert.equal(result.json?.arch, process.arch);
  } finally {
    release(dir);
  }
});

test("unlimited_notrap metrics record the run and do not fail the judge", () => {
  const dir = stage("pass-x64");
  try {
    const line = readFileSync(join(dir, "unl-notrap.out"), "utf8").trim().split("\n").pop() ?? "";
    const expected = JSON.parse(line);
    const result = assertPass(dir, "x64");
    assert.deepEqual(result.json?.metrics?.unlimited_notrap, expected);
    assert.equal(result.json?.metrics?.unlimited_notrap_exit, 0);
    writeFileSync(join(dir, "unl-notrap.code"), "134\n");
    const coded = assertPass(dir, "x64");
    assert.equal(coded.json?.metrics?.unlimited_notrap_exit, 134);
    rmSync(join(dir, "unl-notrap.out"));
    rmSync(join(dir, "unl-notrap.code"));
    const missing = assertPass(dir, "x64");
    assert.equal(missing.json?.metrics?.unlimited_notrap, null);
    assert.equal(missing.json?.metrics?.unlimited_notrap_exit, null);
  } finally {
    release(dir);
  }
});
