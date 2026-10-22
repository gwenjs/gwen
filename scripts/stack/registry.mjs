/**
 * Ephemeral Verdaccio: publish a stack, install a satellite, tear it down.
 */

/**
 * @param {{ storage: string, port: number, host?: string }} _options
 */
export function buildConfig(_options) {
  return {};
}

/**
 * @param {{ packages?: Record<string, { proxy?: string }> }} _config
 * @param {string} _packageName
 */
export function ruleFor(_config, _packageName) {
  return undefined;
}

/**
 * @param {{ packages?: Record<string, { proxy?: string }> }} _config
 */
export function assertNoGwenjsUplink(_config) {}

/**
 * @param {{ bin?: string, command?: string, args?: string[] }} _options
 * @param {(ctx: { url: string, npmrc: string, storage: string }) => unknown} fn
 */
export async function withRegistry(_options, fn) {
  return fn();
}

/**
 * @param {{ url: string, npmrc: string, tarballs: string[] }} _options
 */
export function publishTarballs(_options) {}

/**
 * @param {{ dir: string, url: string, version: string, command: string | string[] }} _options
 */
export function installSatellite(_options) {}

/**
 * @param {{ repo: string, branch: string }} _options
 * @param {(dir: string) => unknown} fn
 */
export async function withRepoCheckout(_options, fn) {
  return fn();
}

function main() {}

import { fileURLToPath } from "node:url";
import path from "node:path";

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
