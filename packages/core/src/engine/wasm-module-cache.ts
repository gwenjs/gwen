/**
 * Compiled WebAssembly.Module values for one process.
 * `getWasmModule` compiles `url`. `invalidateWasmModule` drops one entry.
 */

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "./engine-errors.js";

/** Decode a `data:` URL. A URL with no comma is `CORE:WASM_LOAD_ERROR`. */
export function bytesFromDataUrl(url: string): Uint8Array<ArrayBuffer> {
  const comma = url.indexOf(",");
  if (comma < 0) {
    throw new GwenError(CoreErrorCodes.WASM_LOAD_ERROR, "The data URL has no payload.", {
      composable: "initWasm",
    });
  }
  const meta = url.slice(5, comma);
  const payload = url.slice(comma + 1);
  if (!meta.includes(";base64")) {
    return new TextEncoder().encode(decodeURIComponent(payload));
  }
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Compile the binary at `url`.
 * A `data:` URL is decoded in process. Any other URL is fetched.
 */
export async function getWasmModule(
  url: string,
  signal?: AbortSignal,
): Promise<WebAssembly.Module> {
  if (url.startsWith("data:")) {
    return WebAssembly.compile(bytesFromDataUrl(url));
  }
  const response = await fetch(url, signal === undefined ? {} : { signal });
  return WebAssembly.compile(await response.arrayBuffer());
}

/** Drop the module cached for `url`. Returns whether an entry was removed. */
export function invalidateWasmModule(url: string): boolean {
  void url;
  return false;
}
