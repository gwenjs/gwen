/**
 * Compiled WebAssembly.Module values for one process.
 * `getWasmModule` compiles `url` once. `invalidateWasmModule` drops one entry.
 */

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "./engine-errors.js";

const modules = new Map<string, Promise<WebAssembly.Module>>();

const FETCH_TIMEOUT_MS = 10_000;

const WASM_MODULE_HINT =
  "On a runtime that forbids code generation, pass a precompiled wasmModule.";

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

/** `data:` stays whole. Any other URL becomes an absolute href. */
function moduleKey(url: string): string {
  if (url.startsWith("data:")) return url;
  // `location` is not a binding in Node. `globalThis.location` is the same href.
  return new URL(url, globalThis.location?.href ?? url).href;
}

/** A `data:` URL up to its comma. Any other URL is the normalized href. */
function shortUrl(url: string): string {
  if (!url.startsWith("data:")) return moduleKey(url);
  const comma = url.indexOf(",");
  return comma < 0 ? url : url.slice(0, comma);
}

function compileFailure(url: string, err: WebAssembly.CompileError): GwenError {
  return new GwenError(
    CoreErrorCodes.WASM_LOAD_ERROR,
    `The WASM binary at ${shortUrl(url)} did not compile.`,
    {
      composable: "initWasm",
      cause: err,
      hint: __GWEN_DEV__ ? WASM_MODULE_HINT : undefined,
    },
  );
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

async function compileFetched(response: Response): Promise<WebAssembly.Module> {
  const header = response.headers.get("content-type") ?? "";
  const media = header.split(";")[0] ?? "";
  if (media.trim().toLowerCase() === "application/wasm") {
    return WebAssembly.compileStreaming(response);
  }
  return WebAssembly.compile(await response.arrayBuffer());
}

async function fetchModule(url: string, signal?: AbortSignal): Promise<WebAssembly.Module> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  const onAbort = (): void => {
    controller.abort();
  };
  if (signal !== undefined) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new GwenError(
        CoreErrorCodes.WASM_LOAD_ERROR,
        `The WASM binary fetch failed with HTTP ${response.status} ${response.statusText}.`,
        { composable: "initWasm" },
      );
    }
    return await compileFetched(response);
  } catch (err) {
    if (isAbortError(err)) {
      throw new GwenError(
        CoreErrorCodes.WASM_TIMEOUT,
        "Fetching the WASM binary timed out after 10s.",
        { composable: "initWasm" },
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (signal !== undefined) signal.removeEventListener("abort", onAbort);
  }
}

async function loadModule(url: string, signal?: AbortSignal): Promise<WebAssembly.Module> {
  try {
    if (url.startsWith("data:")) return await WebAssembly.compile(bytesFromDataUrl(url));
    return await fetchModule(url, signal);
  } catch (err) {
    if (err instanceof WebAssembly.CompileError) throw compileFailure(url, err);
    throw err;
  }
}

/**
 * Compile the binary at `url` once per process.
 * A `data:` URL is decoded here. Any other URL is fetched, with a 10s timeout.
 * `signal` aborts that fetch the same way.
 */
export async function getWasmModule(
  url: string,
  signal?: AbortSignal,
): Promise<WebAssembly.Module> {
  const key = moduleKey(url);
  const cached = modules.get(key);
  if (cached !== undefined) return cached;

  const pending = loadModule(url, signal);
  modules.set(key, pending);
  void pending.catch(() => {
    if (modules.get(key) === pending) modules.delete(key);
  });
  return pending;
}

/** Drop the module cached for `url`. Returns whether an entry was removed. */
export function invalidateWasmModule(url: string): boolean {
  return modules.delete(moduleKey(url));
}
