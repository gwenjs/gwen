#!/usr/bin/env node
/**
 * Append a `gwen.build` custom section to a browser WASM binary.
 *
 * The payload is the sha256 hex of the bytes before the section is appended.
 *
 *   node scripts/wasm-build-id.mjs <file.wasm>
 *
 * Rewrites the file and prints the id. Exit 1 on refusal. No dependency.
 */

import { createHash } from "node:crypto";
import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const BUILD_SECTION = "gwen.build";

/**
 * Unsigned LEB128. Values under 128 use one byte.
 * @param {number} value
 * @returns {Uint8Array}
 */
function encodeUnsignedLeb128(value) {
  /** @type {number[]} */
  const bytes = [];
  let rest = value;
  do {
    const low = rest & 0x7f;
    rest = Math.floor(rest / 128);
    bytes.push(rest === 0 ? low : low | 0x80);
  } while (rest !== 0);
  return Uint8Array.from(bytes);
}

/**
 * Section id 0, then the LEB128 content size, the LEB128 name length, the name, and the payload.
 * @param {Uint8Array} bytes
 * @param {string} name
 * @param {Uint8Array} payload
 * @returns {Uint8Array}
 */
export function appendCustomSection(bytes, name, payload) {
  const source = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
  const nameBytes = new TextEncoder().encode(name);
  const nameLen = encodeUnsignedLeb128(nameBytes.length);
  const contentSize = nameLen.length + nameBytes.length + body.length;
  const sizeBytes = encodeUnsignedLeb128(contentSize);
  const out = new Uint8Array(source.length + 1 + sizeBytes.length + contentSize);
  out.set(source, 0);
  let offset = source.length;
  out[offset] = 0;
  offset += 1;
  out.set(sizeBytes, offset);
  offset += sizeBytes.length;
  out.set(nameLen, offset);
  offset += nameLen.length;
  out.set(nameBytes, offset);
  offset += nameBytes.length;
  out.set(body, offset);
  return out;
}

/**
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function countBuildSections(bytes) {
  /** @type {WebAssembly.Module} */
  let compiled;
  try {
    compiled = new WebAssembly.Module(bytes);
  } catch (error) {
    if (error instanceof WebAssembly.CompileError) {
      throw new Error("[wasm-build-id] not a wasm binary");
    }
    throw error;
  }
  return WebAssembly.Module.customSections(compiled, BUILD_SECTION).length;
}

/**
 * @param {Uint8Array} bytes
 * @returns {{ bytes: Uint8Array, id: string }}
 */
export function stampBuildId(bytes) {
  const input = Uint8Array.from(bytes);
  if (countBuildSections(input) !== 0) {
    throw new Error("[wasm-build-id] already stamped");
  }
  const id = createHash("sha256").update(input).digest("hex");
  const stamped = appendCustomSection(input, BUILD_SECTION, new TextEncoder().encode(id));
  return { bytes: stamped, id };
}

/**
 * @returns {boolean}
 */
function invokedAsCli() {
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return import.meta.url === pathToFileURL(entry).href;
  }
}

/**
 * @param {string} message
 * @returns {never}
 */
function failCli(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

function runCli() {
  const filePath = process.argv[2];
  if (typeof filePath !== "string" || filePath.length === 0) {
    failCli("[wasm-build-id] usage: node scripts/wasm-build-id.mjs <file.wasm>");
  }
  let bytes;
  try {
    bytes = readFileSync(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failCli(message);
  }
  try {
    const stamped = stampBuildId(bytes);
    writeFileSync(filePath, stamped.bytes);
    process.stdout.write(`${stamped.id}\n`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    failCli(message);
  }
}

if (invokedAsCli()) {
  runCli();
}
