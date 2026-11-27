/**
 * Gzip size of a built JS chunk that does not depend on which machine built the wasm.
 *
 * The chunk carries two values that are a hash of the wasm bytes: the `buildId` of the factory
 * contract (64 hex characters, which gzip cannot shrink) and the `-<hash>` of each asset name Vite
 * emits. Two builds of the same code on two machines ship another wasm, so these values change
 * and the gzip size moves by a few bytes. Both are replaced by fixed stand-ins of the same shape
 * before compressing.
 */
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

/** A `buildId` key (quoted or not) and its 64 lowercase hex characters. */
const BUILD_ID = /(\bbuildId["'`]?\s*:\s*["'`])[0-9a-f]{64}(?=["'`])/g;
/** `/assets/<name>-<8 characters>.<ext>`: the content hash Vite appends to an emitted file. */
const ASSET_NAME = /(\/assets\/[\w.-]+?-)[A-Za-z0-9_-]{8}(\.(?:js|wasm|css))/g;

const BUILD_ID_STAND_IN = createHash("sha256").update("gwen:stable-gzip:build-id").digest("hex");
const ASSET_HASH_STAND_IN = "x7Hq2LmB";

/**
 * @param {string} text JS source of one built chunk.
 * @returns {string}
 */
export function normalizeBuildHashes(text) {
  return text
    .replace(BUILD_ID, `$1${BUILD_ID_STAND_IN}`)
    .replace(ASSET_NAME, `$1${ASSET_HASH_STAND_IN}$2`);
}

/**
 * Same level as `scripts/check-wasm-size.mjs` (`gzipSync`, level 9).
 *
 * @param {string | Uint8Array} chunk JS source of one built chunk.
 * @returns {number}
 */
export function stableGzipBytes(chunk) {
  const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
  return gzipSync(Buffer.from(normalizeBuildHashes(text)), { level: 9 }).length;
}
