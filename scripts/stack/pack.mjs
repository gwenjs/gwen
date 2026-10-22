/**
 * Pack non-private packages/* at one integration stamp.
 */

/**
 * @param {string} _root
 * @returns {{ dir: string, name: string, version: string }[]}
 */
export function listFrameworkPackages(_root) {
  return [];
}

/**
 * @param {{ root: string, out: string, version: string }} _options
 */
export function packFramework(_options) {}

function main() {}

import { fileURLToPath } from "node:url";
import path from "node:path";

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
