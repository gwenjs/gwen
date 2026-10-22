#!/usr/bin/env node
/**
 * Integration stamp: 1.0.0-integration.<UTC yyyymmddHHMMSS>.g<sha7>.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * @param {Date} date
 * @returns {string}
 */
export function formatUtc(date) {
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}${hours}${minutes}${seconds}`;
}

/**
 * @param {string} sha
 * @param {Date} date
 * @returns {string}
 */
export function stampVersion(sha, date) {
  if (typeof sha !== "string" || !/^[0-9a-f]{7,40}$/i.test(sha)) {
    throw new Error(`STACK:INVALID_SHA: ${sha}`);
  }
  return `1.0.0-integration.${formatUtc(date)}.g${sha.slice(0, 7)}`;
}

/**
 * @param {{ cwd: string, now: Date }} options
 * @returns {string}
 */
export function currentStamp({ cwd, now }) {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    const reason = (result.stderr || result.stdout || "git rev-parse failed").trim();
    throw new Error(`STACK:GIT_FAILED: ${reason}`);
  }
  return stampVersion(result.stdout.trim(), now);
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  /** @type {{ sha?: string, now?: string, cwd?: string }} */
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (next === undefined) throw new Error(`STACK:INVALID_ARG: ${arg}`);
    if (arg === "--sha") parsed.sha = next;
    else if (arg === "--now") parsed.now = next;
    else if (arg === "--cwd") parsed.cwd = next;
    else throw new Error(`STACK:INVALID_ARG: ${arg}`);
    index += 1;
  }
  return parsed;
}

function repoRoot() {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    const date = parsed.now ? new Date(parsed.now) : new Date();
    if (Number.isNaN(date.getTime())) throw new Error(`STACK:INVALID_DATE: ${parsed.now}`);
    const cwd = parsed.cwd ?? repoRoot();
    const stamp = parsed.sha ? stampVersion(parsed.sha, date) : currentStamp({ cwd, now: date });
    process.stdout.write(`${stamp}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
