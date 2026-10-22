// Reads a gate results directory and applies the #264 thresholds.
// stdout: { arch, node, metrics, checks }. Exit 1 when any check is not ok.
import fs from "node:fs";

const TYPED_OOM =
  "RangeError: WebAssembly.Instance(): Out of memory: Cannot allocate Wasm memory for new instance";
const CEILING_MIN = 12000;
const VM_MAX_GIB = 10.1;
const ROOM_MS_MAX = 2.0;
const ROOM_RSS_MAX = 1.0;
const LEAK_SURVIVED = 3000;
const ULIMITS = [16, 32, 64];
const VARIANTS = ["light", "physics2d", "physics3d"];

const R = process.argv[2] ?? "";

/**
 * @param {string} name
 * @returns {string | null}
 */
function readText(name) {
  try {
    return fs.readFileSync(`${R}/${name}`, "utf8");
  } catch {
    return null;
  }
}

/**
 * @param {string} stem
 * @returns {Record<string, unknown> | null}
 */
function lastJson(stem) {
  const text = readText(`${stem}.out`);
  if (text == null) return null;
  const line = text.trim().split("\n").pop();
  if (!line) return null;
  try {
    const value = JSON.parse(line);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
    return null;
  } catch {
    return null;
  }
}

/**
 * @param {string} stem
 * @returns {number | null}
 */
function exitCode(stem) {
  const text = readText(`${stem}.code`);
  if (text == null) return null;
  const trimmed = text.trim();
  if (!/^-?\d+$/.test(trimmed)) return null;
  return Number(trimmed);
}

/**
 * @param {string} stem
 * @returns {string}
 */
function stderrTail(stem) {
  const text = readText(`${stem}.err`);
  if (text == null) return "";
  return text.slice(-400);
}

/**
 * @param {unknown} text
 * @returns {boolean}
 */
function isTypedOom(text) {
  if (typeof text !== "string") return false;
  return text.split("\n").some((line) => line.trim() === TYPED_OOM);
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isEnoent(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

// Missing arch.txt falls back to process.arch. Any other value is checked below.
function readArch() {
  try {
    return fs.readFileSync(`${R}/arch.txt`, "utf8").trim();
  } catch (error) {
    if (isEnoent(error)) return process.arch;
    return null;
  }
}

const arch = readArch();
if (arch !== "x64" && arch !== "arm64") {
  const detail = arch === null ? "arch.txt is unreadable" : `arch is ${JSON.stringify(arch)}`;
  process.stderr.write(`wasm-capacity: expected arch x64 or arm64; ${detail}\n`);
  process.exit(1);
}
const unlimited = lastJson("unl-default");
/** @type {Record<string, unknown>} */
const metrics = { unlimited };
metrics.unlimited_notrap = lastJson("unl-notrap");
metrics.unlimited_notrap_exit = exitCode("unl-notrap");
/** @type {Record<string, { ok: boolean, measured: unknown, threshold: unknown }>} */
const checks = {};

const avg = unlimited?.vm_per_inst_gib_avg;
checks.vm_per_instance_le_10_1_gib = {
  ok: typeof avg === "number" && avg <= VM_MAX_GIB,
  measured: typeof avg === "number" ? avg : null,
  threshold: VM_MAX_GIB,
};

// Ceiling is the instance index where creation failed: failed_at, else held.
const ceiling =
  unlimited != null &&
  (typeof unlimited.failed_at === "number" || typeof unlimited.held === "number")
    ? (unlimited.failed_at ?? unlimited.held)
    : null;
const ceilingKey = arch === "arm64" ? "arm64_ceiling_ge_12000" : "x64_ceiling_ge_12000";
checks[ceilingKey] = {
  ok: typeof ceiling === "number" && ceiling >= CEILING_MIN,
  measured: typeof ceiling === "number" ? ceiling : null,
  threshold: CEILING_MIN,
};

const stderr = stderrTail("unl-default");
const stderrOom = stderr
  .split("\n")
  .map((line) => line.trim())
  .find((line) => line === TYPED_OOM);
const matchedOom = isTypedOom(unlimited?.error)
  ? String(unlimited?.error).trim()
  : (stderrOom ?? null);
const unlimitedCode = exitCode("unl-default");
checks.ceiling_error_is_typed_range_error = {
  ok: matchedOom !== null && unlimitedCode === 0,
  measured: matchedOom ?? (typeof unlimited?.error === "string" ? unlimited.error : stderr || null),
  threshold: TYPED_OOM,
};

/** @type {Record<string, number | null>} */
const formulaMeasured = {};
/** @type {Record<string, number | null>} */
const formulaThreshold = {};
let formulaOk = true;
for (const limit of ULIMITS) {
  const row = lastJson(`ul${limit}-default`);
  metrics[`ulimit${limit}`] = row;
  const failed = row?.failed_at;
  formulaMeasured[String(limit)] = typeof failed === "number" ? failed : null;
  const base = row?.base_vm_gib;
  if (typeof base !== "number") {
    formulaThreshold[String(limit)] = null;
    formulaOk = false;
    continue;
  }
  const expect = Math.floor((limit - base) / 10) + 1;
  formulaThreshold[String(limit)] = expect;
  const typed = row != null && isTypedOom(row.error);
  const near = typeof failed === "number" && Math.abs(failed - expect) <= 1;
  if (!typed || !near) formulaOk = false;
}
checks.ulimit_16_32_64_formula_pm1 = {
  ok: formulaOk,
  measured: formulaMeasured,
  threshold: formulaThreshold,
};

for (const variant of VARIANTS) {
  const row = lastJson(`start-${variant}`);
  metrics[`start_${variant}`] = row;
  const ms = row?.ms_per_room;
  const rss = row?.rss_per_room_mib;
  checks[`room_cost_le_2ms_1mib_${variant}`] = {
    ok:
      typeof ms === "number" && typeof rss === "number" && ms <= ROOM_MS_MAX && rss <= ROOM_RSS_MAX,
    measured: row
      ? {
          ms_per_room: typeof ms === "number" ? ms : null,
          rss_per_room_mib: typeof rss === "number" ? rss : null,
        }
      : null,
    threshold: { ms_per_room: ROOM_MS_MAX, rss_per_room_mib: ROOM_RSS_MAX },
  };
}

const det = lastJson("det");
metrics.det = det;
const physics2d = det?.physics2d;
const physics3d = det?.physics3d;
checks.determinism_equal_modes = {
  ok:
    physics2d?.all_equal === true &&
    physics3d?.all_equal === true &&
    physics2d?.moved === true &&
    physics3d?.moved === true,
  measured: det
    ? {
        physics2d: { all_equal: physics2d?.all_equal ?? null, moved: physics2d?.moved ?? null },
        physics3d: { all_equal: physics3d?.all_equal ?? null, moved: physics3d?.moved ?? null },
      }
    : null,
  threshold: { all_equal: true, moved: true },
};

const leak = lastJson("leak64");
metrics.leak64 = leak;
const survived = leak?.survived;
checks.dropped_3000_rooms_reclaimed_under_64gib = {
  ok: survived === LEAK_SURVIVED,
  measured: typeof survived === "number" ? survived : null,
  threshold: LEAK_SURVIVED,
};

/** @type {Record<string, number | null>} */
const notrapMeasured = {};
let notrapOk = true;
for (const limit of ULIMITS) {
  const code = exitCode(`ul${limit}-notrap`);
  metrics[`ulimit${limit}_notrap_exit`] = code;
  notrapMeasured[String(limit)] = code;
  if (code === null) notrapOk = false;
}
checks.notrap_with_limit_exit_134_recorded = {
  ok: notrapOk,
  measured: notrapMeasured,
  threshold: "recorded",
};

const out = { arch, node: process.version, metrics, checks };
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
process.exit(Object.values(checks).some((check) => check.ok === false) ? 1 : 0);
