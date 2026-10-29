import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { fileURLToPath } from "node:url";

import { GwenError } from "@gwenjs/schema";
import { afterEach, expect, it } from "vitest";

import { getWasmModule, invalidateWasmModule } from "../../src/engine/wasm-module-cache.js";

const WASM_MODULE_HINT =
  "On a runtime that forbids code generation, pass a precompiled wasmModule.";
const COMPILE_WHAT = "The WASM binary at data:application/wasm;base64 did not compile.";
const TIMEOUT_WHAT = "Fetching the WASM binary timed out after 10s.";
const BAD_WASM_URL = "data:application/wasm;base64,AAAA";

const LIGHT_WASM = wasmBytes("../../wasm/light/gwen_core_bg.wasm");

const originalCompile = WebAssembly.compile;

type CompileFn = typeof WebAssembly.compile;

let compileCalls = 0;

function countingCompile(...args: Parameters<CompileFn>): ReturnType<CompileFn> {
  compileCalls += 1;
  return originalCompile(...args);
}

afterEach(() => {
  WebAssembly.compile = originalCompile;
  compileCalls = 0;
});

function wasmBytes(relativePath: string): Uint8Array<ArrayBuffer> {
  const wasmPath = fileURLToPath(new URL(relativePath, import.meta.url));
  const file = readFileSync(wasmPath);
  const bytes = new Uint8Array(file.byteLength);
  bytes.set(file);
  return bytes;
}

function dataUrl(bytes: Uint8Array<ArrayBuffer>): string {
  return `data:application/wasm;base64,${Buffer.from(bytes).toString("base64")}`;
}

interface Served {
  port: number;
  hits: () => number;
  close: () => Promise<void>;
}

function listen(server: Server): Promise<void> {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => undefined);
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function serve(onRequest: (hits: number, response: ServerResponse) => void): Promise<Served> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    onRequest(hits, response);
  });
  try {
    await listen(server);
  } catch (error) {
    server.close();
    throw error;
  }
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("test server has no port");
  }
  return {
    port: address.port,
    hits: () => hits,
    close: () => closeServer(server),
  };
}

function sendWasm(response: ServerResponse): void {
  response.statusCode = 200;
  response.setHeader("content-type", "application/wasm");
  response.end(LIGHT_WASM);
}

function href(port: number, path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

/** The call's resolution, or the rejection. A thrown value stays inside the test. */
async function settled(run: () => Promise<unknown>): Promise<unknown> {
  try {
    return await run();
  } catch (error: unknown) {
    return error;
  }
}

it("two getWasmModule calls with one URL return the same Module", async () => {
  const served = await serve((_hits, response) => {
    sendWasm(response);
  });
  try {
    const url = href(served.port, "/m.wasm");
    const first = await getWasmModule(url);
    const second = await getWasmModule(url);
    expect(second).toBe(first);
    expect(served.hits()).toBe(1);
  } finally {
    await served.close();
  }
});

it("two spellings of one absolute URL share one entry", async () => {
  const served = await serve((_hits, response) => {
    sendWasm(response);
  });
  try {
    const dotted = href(served.port, "/a/../m.wasm");
    const plain = href(served.port, "/m.wasm");
    const first = await getWasmModule(dotted);
    const second = await getWasmModule(plain);
    expect(second).toBe(first);
    expect(served.hits()).toBe(1);
  } finally {
    await served.close();
  }
});

it("a data: URL is decoded and compiled once", async () => {
  compileCalls = 0;
  WebAssembly.compile = countingCompile;
  const url = dataUrl(LIGHT_WASM);
  const first = await getWasmModule(url);
  const second = await getWasmModule(url);
  expect(second).toBe(first);
  expect(compileCalls).toBe(1);
});

it("a rejected compile is not cached", async () => {
  const served = await serve((hits, response) => {
    if (hits === 1) {
      response.statusCode = 500;
      response.setHeader("content-type", "text/plain");
      response.end("nope");
      return;
    }
    sendWasm(response);
  });
  try {
    const url = href(served.port, "/m.wasm");
    const first = await settled(() => getWasmModule(url));
    expect(first).toBeInstanceOf(GwenError);
    expect(first).toMatchObject({ code: "CORE:WASM_LOAD_ERROR" });

    const second = await settled(() => getWasmModule(url));
    expect(second).toBeInstanceOf(WebAssembly.Module);
    if (!(second instanceof WebAssembly.Module)) return;

    const hitsAfterSecond = served.hits();
    const third = await settled(() => getWasmModule(url));
    expect(third).toBe(second);
    expect(served.hits()).toBe(hitsAfterSecond);
  } finally {
    await served.close();
  }
});

it("invalidateWasmModule drops the cached Module", async () => {
  const served = await serve((_hits, response) => {
    sendWasm(response);
  });
  try {
    const url = href(served.port, "/m.wasm");
    const unknown = href(served.port, "/missing.wasm");
    expect(invalidateWasmModule(url)).toBe(false);
    expect(invalidateWasmModule(unknown)).toBe(false);

    const first = await getWasmModule(url);
    expect(invalidateWasmModule(url)).toBe(true);
    const second = await getWasmModule(url);
    expect(second).not.toBe(first);
    expect(invalidateWasmModule(url)).toBe(false);
    expect(invalidateWasmModule(unknown)).toBe(false);
  } finally {
    await served.close();
  }
});

it("a CompileError maps to CORE:WASM_LOAD_ERROR with a wasmModule hint", async () => {
  const caught = await settled(() => getWasmModule(BAD_WASM_URL));
  expect(caught).toBeInstanceOf(GwenError);
  expect(caught).toMatchObject({ code: "CORE:WASM_LOAD_ERROR" });
  if (!(caught instanceof GwenError)) return;
  expect(caught.message).toContain(COMPILE_WHAT);
  expect(caught.hint).toBe(__GWEN_DEV__ ? WASM_MODULE_HINT : undefined);
  expect(caught.cause).toBeInstanceOf(WebAssembly.CompileError);
});

it("an aborted signal maps to CORE:WASM_TIMEOUT", async () => {
  const served = await serve((_hits, response) => {
    sendWasm(response);
  });
  try {
    const caught = await settled(() =>
      getWasmModule(href(served.port, "/m.wasm"), AbortSignal.abort()),
    );
    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).toMatchObject({ code: "CORE:WASM_TIMEOUT" });
    if (!(caught instanceof GwenError)) return;
    expect(caught.message).toContain(TIMEOUT_WHAT);
  } finally {
    await served.close();
  }
});
