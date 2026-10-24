#!/usr/bin/env node
/**
 * Compiling stub for the red commit. No-op. The real file is scripts/wasm-build-id.mjs.
 */

/**
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function appendCustomSection(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ bytes: Uint8Array, id: string }}
 */
export function stampBuildId(bytes) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return { bytes: input, id: "" };
}
