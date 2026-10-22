/**
 * Integration stamp: 1.0.0-integration.<UTC yyyymmddHHMMSS>.g<sha7>.
 */

/**
 * @param {Date} _date
 * @returns {string}
 */
export function formatUtc(_date) {
  return "";
}

/**
 * @param {string} _sha
 * @param {Date} _date
 * @returns {string}
 */
export function stampVersion(_sha, _date) {
  return "";
}

/**
 * @param {{ cwd: string, now: Date }} _options
 * @returns {string}
 */
export function currentStamp(_options) {
  return "";
}

function main() {}

import { fileURLToPath } from "node:url";
import path from "node:path";

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
