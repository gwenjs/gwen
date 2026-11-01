/**
 * `loadWasmModule` accepts exactly one of `url`, `bytes`, or `module`.
 * The fetch stub throws, so a passing load cannot have downloaded a binary.
 * Cap tests that fetch put the real `fetch` back inside the test.
 * `WebAssembly.compile` is spied and restored in afterEach.
 * Cap checks compare that count with the value taken after `createRealEngine`
 * returns. The first engine in a process compiles the core binary once
 * (`packages/core/src/engine/wasm-module-cache.ts:112`, then reused at
 * `packages/core/src/engine/wasm-module-cache.ts:130`), so a raw count of 0
 * depends on which test ran first.
 */
import { createServer, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import { createRealEngine } from "../../src/testing/create-real-engine.js";

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    b: WebAssembly.Exports;
    m: WebAssembly.Exports;
    z: WebAssembly.Exports;
    t: WebAssembly.Exports;
    i: WebAssembly.Exports;
  }
}

// (func (export "gwen_plugin_api_version") (result i32) (i32.const 2001000))
const EMPTY_WASM = Uint8Array.from(
  Buffer.from(
    "0061736d010000000105016000017f03020100071b01176777656e5f706c7567696e5f6170695f76657273696f6e00000a0901070041e890fa000b",
    "hex",
  ),
);

const originalFetch = globalThis.fetch;

const compileCalls = {
  count: (): number => 0,
  restore: (): void => undefined,
};

interface Served {
  url: string;
  close: () => Promise<void>;
}

function listen(server: Server): Promise<void> {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => undefined);
}

function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function serveWith(respond: (response: ServerResponse) => void): Promise<Served> {
  const server = createServer((_request, response) => {
    _request.on("error", () => undefined);
    response.on("error", () => undefined);
    respond(response);
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    await closeServer(server);
    throw new Error("test server has no port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/mod.wasm`,
    close: () => closeServer(server),
  };
}

function serveBytes(body: Uint8Array): Promise<Served> {
  return serveWith((response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/wasm");
    response.setHeader("content-length", String(body.byteLength));
    response.end(body);
  });
}

function serveChunked(first: Uint8Array, second: Uint8Array): Promise<Served> {
  return serveWith((response) => {
    response.statusCode = 200;
    response.setHeader("content-type", "application/wasm");
    response.write(first);
    response.write(second);
    response.end();
  });
}

interface Held extends Served {
  /** Resolves on the server response `close`. Created before the load. */
  closed: Promise<void>;
}

/** One write, then the response stays open so a client cancel is visible. */
function serveHeld(write: (response: ServerResponse) => void): Promise<Held> {
  let markClosed: () => void = () => undefined;
  const closed = new Promise<void>((resolve) => {
    markClosed = () => {
      resolve();
    };
  });
  return serveWith((response) => {
    response.on("close", () => {
      markClosed();
    });
    response.statusCode = 200;
    response.setHeader("content-type", "application/wasm");
    write(response);
  }).then((served) => ({
    url: served.url,
    close: served.close,
    closed,
  }));
}

async function caughtOf(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return undefined;
  } catch (error: unknown) {
    return error;
  }
}

function expectCapError(caught: unknown, parts: readonly string[], compilesBefore: number): void {
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw caught;
  expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
  for (const part of parts) expect(caught.message).toContain(part);
  expect(caught.message).not.toContain("Failed to load WASM module");
  expect(compileCalls.count() - compilesBefore).toBe(0);
}

describe("loadWasmModule source", () => {
  beforeEach(() => {
    globalThis.fetch = () => {
      throw new Error("fetch called");
    };
    const spy = vi.spyOn(WebAssembly, "compile");
    compileCalls.count = () => spy.mock.calls.length;
    compileCalls.restore = () => {
      spy.mockRestore();
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    compileCalls.restore();
    compileCalls.count = () => 0;
    compileCalls.restore = () => undefined;
  });

  it("bytes load a module without fetch", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      const loaded = await handle.engine.loadWasmModule({ name: "b", bytes: EMPTY_WASM });
      expect(typeof loaded.exports.gwen_plugin_api_version).toBe("function");
      expect(handle.engine.getWasmModule("b")).toBe(loaded);
    } finally {
      await handle.dispose();
    }
  });

  it("module loads without fetch and is instantiated as an Instance", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      const loaded = await handle.engine.loadWasmModule({
        name: "m",
        module: new WebAssembly.Module(EMPTY_WASM),
      });
      const version = loaded.exports.gwen_plugin_api_version;
      expect(typeof version).toBe("function");
      if (typeof version !== "function")
        throw new Error("gwen_plugin_api_version is not a function");
      const returned: unknown = Reflect.apply(version, undefined, []);
      expect(returned).toBe(2_001_000);
      expect(handle.engine.getWasmModule("m")).toBe(loaded);
    } finally {
      await handle.dispose();
    }
  });

  it("zero sources reject with CORE:WASM_LOAD_ERROR naming url, bytes and module", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      let caught: unknown;
      try {
        await handle.engine.loadWasmModule({ name: "z" });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("needs exactly one of url, bytes or module; got 0.");

      let missing: unknown;
      try {
        handle.engine.getWasmModule("z");
      } catch (error: unknown) {
        missing = error;
      }
      expect(missing).toBeInstanceOf(GwenError);
      if (!(missing instanceof GwenError)) throw missing;
      expect(missing.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
    } finally {
      await handle.dispose();
    }
  });

  it("two sources reject with CORE:WASM_LOAD_ERROR", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      let caught: unknown;
      try {
        await handle.engine.loadWasmModule({
          name: "t",
          url: "https://example.invalid/t.wasm",
          bytes: EMPTY_WASM,
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("got 2.");

      let missing: unknown;
      try {
        handle.engine.getWasmModule("t");
      } catch (error: unknown) {
        missing = error;
      }
      expect(missing).toBeInstanceOf(GwenError);
      if (!(missing instanceof GwenError)) throw missing;
      expect(missing.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
    } finally {
      await handle.dispose();
    }
  });

  it("invalid bytes reject with CORE:WASM_LOAD_ERROR, not a CompileError", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    try {
      let caught: unknown;
      try {
        await handle.engine.loadWasmModule({ name: "i", bytes: new Uint8Array([0, 1, 2]) });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught).not.toBeInstanceOf(WebAssembly.CompileError);
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("bytes (3 bytes)");
    } finally {
      await handle.dispose();
    }
  });

  it("rejects one byte over maxBytes before compile", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    const n = EMPTY_WASM.byteLength;
    try {
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "over",
          bytes: EMPTY_WASM,
          maxBytes: n - 1,
        }),
      );
      expectCapError(caught, [`${n} bytes`, `${n - 1}-byte cap`], compilesBefore);
    } finally {
      await handle.dispose();
    }
  });

  it("loads at maxBytes", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    const n = EMPTY_WASM.byteLength;
    try {
      // One byte under the cap must fail, or a build that ignores maxBytes stays green.
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "other",
          bytes: EMPTY_WASM,
          maxBytes: n - 1,
        }),
      );
      expectCapError(caught, [`${n} bytes`, `${n - 1}-byte cap`], compilesBefore);
      const loaded = await handle.engine.loadWasmModule({
        name: "at",
        bytes: EMPTY_WASM,
        maxBytes: n,
      });
      expect(typeof loaded.exports.gwen_plugin_api_version).toBe("function");
    } finally {
      await handle.dispose();
    }
  });

  it("a module source skips the cap", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    const n = EMPTY_WASM.byteLength;
    try {
      // Bytes at maxBytes 1 must fail. A compiled module then loads at the same cap.
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "other",
          bytes: EMPTY_WASM,
          maxBytes: 1,
        }),
      );
      expectCapError(caught, [`${n} bytes`, "1-byte cap"], compilesBefore);
      const loaded = await handle.engine.loadWasmModule({
        name: "skip",
        module: new WebAssembly.Module(EMPTY_WASM),
        maxBytes: 1,
      });
      expect(typeof loaded.exports.gwen_plugin_api_version).toBe("function");
    } finally {
      await handle.dispose();
    }
  });

  it("the default cap rejects 16 MiB + 1 bytes before compile", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    try {
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "def",
          bytes: new Uint8Array(16 * 1024 * 1024 + 1),
        }),
      );
      expectCapError(caught, ["16777217 bytes", "16777216-byte cap"], compilesBefore);
    } finally {
      await handle.dispose();
    }
  });

  it("a fetched module over maxBytes rejects before compile", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    let served: Served | undefined;
    try {
      served = await serveBytes(EMPTY_WASM);
      const url = served.url;
      globalThis.fetch = originalFetch;
      const n = EMPTY_WASM.byteLength;
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "url",
          url,
          maxBytes: n - 1,
        }),
      );
      expectCapError(caught, [`${n} bytes`, `${n - 1}-byte cap`], compilesBefore);
    } finally {
      try {
        await served?.close();
      } finally {
        await handle.dispose();
      }
    }
  });

  it("a fetched body with no content-length is cancelled past maxBytes", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    let served: Served | undefined;
    const cap = 8;
    try {
      served = await serveChunked(new Uint8Array(cap), new Uint8Array(cap));
      const url = served.url;
      globalThis.fetch = originalFetch;
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "chunk",
          url,
          maxBytes: cap,
        }),
      );
      expectCapError(caught, [`more than ${cap} bytes`, `${cap}-byte cap`], compilesBefore);
    } finally {
      try {
        await served?.close();
      } finally {
        await handle.dispose();
      }
    }
  });

  it("a fetched body past maxBytes is cancelled", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    let served: Held | undefined;
    const cap = 8;
    try {
      served = await serveHeld((response) => {
        response.write(new Uint8Array(cap + 1));
      });
      const url = served.url;
      const closed = served.closed;
      globalThis.fetch = originalFetch;
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "past",
          url,
          maxBytes: cap,
        }),
      );
      expectCapError(caught, [`more than ${cap} bytes`, `${cap}-byte cap`], compilesBefore);
      await closed;
    } finally {
      try {
        await served?.close();
      } finally {
        await handle.dispose();
      }
    }
  });

  it("a fetched module over the content-length cap is cancelled", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    let served: Held | undefined;
    const cap = 8;
    try {
      served = await serveHeld((response) => {
        response.setHeader("content-length", String(cap + 1));
        response.write(new Uint8Array(4));
      });
      const url = served.url;
      const closed = served.closed;
      globalThis.fetch = originalFetch;
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "clen",
          url,
          maxBytes: cap,
        }),
      );
      expectCapError(caught, [`${cap + 1} bytes`, `${cap}-byte cap`], compilesBefore);
      await closed;
    } finally {
      try {
        await served?.close();
      } finally {
        await handle.dispose();
      }
    }
  });

  it("maxBytes 0 rejects with CORE:WASM_LOAD_ERROR", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    try {
      const caught = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "zero",
          bytes: EMPTY_WASM,
          maxBytes: 0,
        }),
      );
      expectCapError(caught, ["maxBytes must be a positive integer; got 0."], compilesBefore);
    } finally {
      await handle.dispose();
    }
  });

  it("maxBytes 1.5 and NaN reject with CORE:WASM_LOAD_ERROR", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 16 });
    const compilesBefore = compileCalls.count();
    try {
      const fractional = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "frac",
          bytes: EMPTY_WASM,
          maxBytes: 1.5,
        }),
      );
      expectCapError(fractional, ["maxBytes must be a positive integer; got 1.5."], compilesBefore);
      const missing = await caughtOf(() =>
        handle.engine.loadWasmModule({
          name: "nan",
          bytes: EMPTY_WASM,
          maxBytes: Number.NaN,
        }),
      );
      expectCapError(missing, ["maxBytes must be a positive integer; got NaN."], compilesBefore);
    } finally {
      await handle.dispose();
    }
  });
});
