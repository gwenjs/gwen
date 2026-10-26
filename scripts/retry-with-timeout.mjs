#!/usr/bin/env node
/**
 * Run a command up to N times. Each attempt is its own process group and has
 * a timeout. A timeout sends SIGTERM to the group, waits up to --grace
 * seconds (default 5), then SIGKILL and waits that long again. The attempt
 * ends once the group is gone, or after a one-line warning if it is not.
 * The first exit 0 ends the run. After the last failed attempt the script
 * exits with that child's status, or 124 when the attempt timed out. A child
 * killed by a signal exits 128 plus the signal number.
 *
 * Usage:
 *   node scripts/retry-with-timeout.mjs --attempts <N> --timeout <seconds> [--grace <seconds>] -- <command> [args...]
 */

import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {string} message
 * @returns {never}
 */
function usage(message) {
  process.stderr.write(`retry-with-timeout: ${message}\n`);
  process.exit(2);
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isPositiveInteger(value) {
  return typeof value === "string" && /^[1-9]\d*$/.test(value);
}

/**
 * @param {string | undefined} value
 * @returns {boolean}
 */
function isPositiveNumber(value) {
  if (typeof value !== "string" || !/^(?:\d+\.\d+|\d+|\.\d+)$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0;
}

/**
 * @param {string[]} argv
 * @returns {{ attempts: number, timeoutMs: number, timeoutLabel: string, graceMs: number, command: string, args: string[] }}
 */
function parseArgs(argv) {
  /** @type {string | undefined} */
  let attemptsRaw;
  /** @type {string | undefined} */
  let timeoutRaw;
  /** @type {string | undefined} */
  let graceRaw = "5";
  /** @type {string[]} */
  const commandArgs = [];
  let sawSeparator = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (sawSeparator) {
      commandArgs.push(arg);
      continue;
    }
    if (arg === "--") {
      sawSeparator = true;
      continue;
    }
    if (arg === "--attempts") {
      attemptsRaw = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--timeout") {
      timeoutRaw = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg === "--grace") {
      graceRaw = argv[index + 1];
      index += 1;
      continue;
    }
    if (arg.startsWith("--")) usage(`unknown flag ${arg}`);
    usage("missing --");
  }

  if (!sawSeparator) usage("missing --");
  if (!isPositiveInteger(attemptsRaw)) usage("attempts is not a positive integer");
  if (!isPositiveNumber(timeoutRaw) || timeoutRaw === undefined)
    usage("timeout is not a positive number");
  if (!isPositiveNumber(graceRaw)) usage("grace is not a positive number");
  const command = commandArgs[0];
  if (!command) usage("empty command");

  return {
    attempts: Number(attemptsRaw),
    timeoutMs: Math.round(Number(timeoutRaw) * 1000),
    timeoutLabel: timeoutRaw,
    graceMs: Math.round(Number(graceRaw) * 1000),
    command,
    args: commandArgs.slice(1),
  };
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorCode(error) {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : "";
}

/**
 * @param {number} pid
 * @param {NodeJS.Signals | 0} signal
 */
function signalGroup(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch {
    // ESRCH: the group is already gone. EPERM: a member is not signalable.
  }
}

/**
 * EPERM means the group still has a member. Only ESRCH means it is gone.
 *
 * @param {number} pid
 * @returns {boolean}
 */
function groupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return errorCode(error) !== "ESRCH";
  }
}

/**
 * @param {number} pid
 * @param {number} graceMs
 * @returns {Promise<boolean>}
 */
function groupGone(pid, graceMs) {
  const deadline = Date.now() + graceMs;
  return new Promise((resolve) => {
    const tick = () => {
      if (!groupAlive(pid)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(tick, 50);
    };
    tick();
  });
}

/**
 * SIGTERM the group, wait up to graceMs, then SIGKILL and wait again.
 * Resolves after those waits even if the group is still alive.
 *
 * @param {number} pid
 * @param {number} graceMs
 * @returns {Promise<void>}
 */
async function reapGroup(pid, graceMs) {
  signalGroup(pid, "SIGTERM");
  if (await groupGone(pid, graceMs)) return;
  signalGroup(pid, "SIGKILL");
  if (await groupGone(pid, graceMs)) return;
  process.stderr.write(`retry-with-timeout: process group ${pid} still alive\n`);
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {number} timeoutMs
 * @param {number} graceMs
 * @returns {Promise<{ exitCode: number, timedOut: boolean }>}
 */
function runAttempt(command, args, timeoutMs, graceMs) {
  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;

    // detached starts a new process group so a timeout can signal the whole tree.
    const child = spawn(command, args, {
      stdio: "inherit",
      detached: true,
    });

    const timer = setTimeout(() => {
      timedOut = true;
      const pid = child.pid;
      if (pid === undefined) {
        finish({ exitCode: 124, timedOut: true });
        return;
      }
      void reapGroup(pid, graceMs).then(() => {
        finish({ exitCode: 124, timedOut: true });
      });
    }, timeoutMs);

    /**
     * @param {{ exitCode: number, timedOut: boolean }} result
     */
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    }

    child.on("error", (error) => {
      const code = typeof error === "object" && error !== null && "code" in error ? error.code : "";
      finish({ exitCode: code === "ENOENT" ? 127 : 1, timedOut: false });
    });

    child.on("exit", (code, signal) => {
      if (timedOut) return;
      if (signal) {
        finish({ exitCode: 128 + os.constants.signals[signal], timedOut: false });
        return;
      }
      finish({ exitCode: code === null ? 1 : code, timedOut: false });
    });
  });
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function retry(argv) {
  const parsed = parseArgs(argv);
  /** @type {{ exitCode: number, timedOut: boolean }} */
  let last = { exitCode: 1, timedOut: false };
  for (let attempt = 1; attempt <= parsed.attempts; attempt += 1) {
    process.stderr.write(`retry-with-timeout: attempt ${attempt}/${parsed.attempts}\n`);
    const result = await runAttempt(parsed.command, parsed.args, parsed.timeoutMs, parsed.graceMs);
    if (result.exitCode === 0) return 0;
    if (result.timedOut) {
      process.stderr.write(
        `retry-with-timeout: attempt ${attempt}/${parsed.attempts} timed out after ${parsed.timeoutLabel}s\n`,
      );
    } else {
      process.stderr.write(
        `retry-with-timeout: attempt ${attempt}/${parsed.attempts} failed (exit ${result.exitCode})\n`,
      );
    }
    last = result;
  }
  return last.exitCode;
}

async function main() {
  const code = await retry(process.argv.slice(2));
  process.exit(code);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`retry-with-timeout: ${message}\n`);
    process.exit(1);
  });
}
