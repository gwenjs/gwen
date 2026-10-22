#!/usr/bin/env node
/**
 * Fail when `pnpm audit --prod --json` reports a high or critical advisory.
 * Moderate advisories are printed and do not fail the run.
 * Run: node scripts/npm-audit.mjs
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @typedef {{ fail: boolean, high: number, critical: number, moderate: number, lines: string[] }} AuditVerdict
 */

/**
 * @typedef {{ stdout: string, stderr: string, status: number | null, error?: Error }} AuditRun
 */

/**
 * @typedef {{
 *   run: () => AuditRun,
 *   sleep: (ms: number) => void | Promise<void>,
 *   log: (line: string) => void,
 *   error: (line: string) => void,
 * }} AuditIo
 */

const SEVERITY_RANK = new Map([
  ["critical", 0],
  ["high", 1],
  ["moderate", 2],
]);

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isPlainObject(value) {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * @param {string} reason
 * @returns {never}
 */
function unusable(reason) {
  throw new Error(`[npm-audit] unusable audit output: ${reason}`);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isNonNegativeInteger(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * @param {unknown} severity
 * @returns {number}
 */
function severityRank(severity) {
  if (typeof severity !== "string") return 3;
  return SEVERITY_RANK.get(severity) ?? 3;
}

/**
 * @param {Record<string, unknown>} advisory
 * @returns {string}
 */
function advisoryLine(advisory) {
  const severity = typeof advisory.severity === "string" ? advisory.severity : "";
  const moduleName = typeof advisory.module_name === "string" ? advisory.module_name : "";
  const url = typeof advisory.url === "string" ? advisory.url : "";
  return `[npm-audit] ${severity} ${moduleName} ${url}`;
}

/**
 * @param {unknown} json
 * @returns {AuditVerdict}
 */
export function judgeAudit(json) {
  if (!isPlainObject(json)) unusable("not an object");
  const metadata = json.metadata;
  const vulnerabilities = isPlainObject(metadata) ? metadata.vulnerabilities : undefined;
  if (!isPlainObject(vulnerabilities)) unusable("missing vulnerability counts");
  const high = vulnerabilities.high;
  const critical = vulnerabilities.critical;
  const moderate = vulnerabilities.moderate;
  if (
    !isNonNegativeInteger(high) ||
    !isNonNegativeInteger(critical) ||
    !isNonNegativeInteger(moderate)
  ) {
    unusable("vulnerability counts are not non-negative integers");
  }

  /** @type {string[]} */
  const lines = [`[npm-audit] high=${high} critical=${critical} moderate=${moderate}`];
  if (Object.hasOwn(json, "advisories")) {
    const advisories = json.advisories;
    if (!isPlainObject(advisories)) unusable("advisories is not an object");
    const entries = Object.values(advisories).filter(isPlainObject);
    entries.sort((left, right) => severityRank(left.severity) - severityRank(right.severity));
    for (const entry of entries) lines.push(advisoryLine(entry));
  }

  return { fail: high + critical > 0, high, critical, moderate, lines };
}

/**
 * @param {unknown} result
 * @returns {AuditVerdict | undefined}
 */
function verdictFrom(result) {
  if (!isPlainObject(result) || typeof result.stdout !== "string") return undefined;
  /** @type {unknown} */
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    return undefined;
  }
  try {
    return judgeAudit(json);
  } catch {
    return undefined;
  }
}

/**
 * @param {unknown} text
 * @returns {string}
 */
function firstLine(text) {
  if (typeof text !== "string" || text === "") return "";
  const breakAt = text.search(/\r?\n/);
  return breakAt === -1 ? text : text.slice(0, breakAt);
}

/**
 * @param {unknown} result
 * @returns {string}
 */
function unreachableDetail(result) {
  const stderr = isPlainObject(result) ? firstLine(result.stderr) : "";
  if (stderr !== "") return stderr;
  const error = isPlainObject(result) ? result.error : undefined;
  const message = error instanceof Error ? firstLine(error.message) : "";
  if (message !== "") return message;
  return "no error output";
}

/**
 * @param {AuditIo} io
 * @returns {Promise<number>}
 */
export async function runAudit({ run, sleep, log, error }) {
  let result = run();
  let verdict = verdictFrom(result);
  if (!verdict) {
    await sleep(10000);
    result = run();
    verdict = verdictFrom(result);
  }
  if (!verdict) {
    error(`[npm-audit] registry unreachable: ${unreachableDetail(result)}`);
    return 2;
  }
  for (const line of verdict.lines) log(line);
  return verdict.fail ? 1 : 0;
}

export const AUDIT_ARGS = ["audit", "--prod", "--json"];

/**
 * @returns {AuditRun}
 */
function runPnpmAudit() {
  const result = spawnSync("pnpm", AUDIT_ARGS, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return {
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
    status: result.status,
    ...(result.error ? { error: result.error } : {}),
  };
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  process.exitCode = await runAudit({
    run: runPnpmAudit,
    sleep(ms) {
      return new Promise((resolve) => {
        setTimeout(resolve, ms);
      });
    },
    log(line) {
      console.log(line);
    },
    error(line) {
      console.error(line);
    },
  });
}
