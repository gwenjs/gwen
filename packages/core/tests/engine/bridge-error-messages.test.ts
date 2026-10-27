/**
 * Message arguments of the WASM bridge throws (P-64-5).
 * The codes and the control flow stay. Only the rendered text moves.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GwenError } from "@gwenjs/schema";
import { WasmBridgeImpl } from "../../src/internal";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";

const MINIMAL_WASM_URL = `data:application/wasm;base64,${Buffer.from(
  "0061736d010000000105016000017f03020100071b01176777656e5f706c7567696e5f6170695f76657273696f6e00000a09010700418089fa000b",
  "hex",
).toString("base64")}`;

const LOAD_SEE =
  "See https://gwenjs.github.io/gwen/api/errors#core-wasm-load-error (CORE:WASM_LOAD_ERROR)";
const TIMEOUT_MESSAGE =
  "[initWasm()] Fetching the WASM binary timed out after 10s.\nSee https://gwenjs.github.io/gwen/api/errors#core-wasm-timeout (CORE:WASM_TIMEOUT)";

afterEach(() => {
  for (const key of Object.keys(globalThis)) {
    if (key.startsWith("__gwenGlue_")) Reflect.deleteProperty(globalThis, key);
  }
});

function glueFile(): { dir: string; jsUrl: string } {
  const dir = mkdtempSync(join(tmpdir(), "gwen-bridge-err-"));
  const file = join(dir, "glue.mjs");
  writeFileSync(file, "export default function init() { return {}; }\n", "utf8");
  return { dir, jsUrl: pathToFileURL(file).href };
}

/** Rejects when the bridge aborts the fetch. Resolves `markFetchStarted` on entry. */
function hangingFetch(
  markFetchStarted: () => void,
): (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => Promise<Response> {
  return (_input, init) => {
    markFetchStarted();
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      if (signal === undefined || signal === null) return;
      const onAbort = (): void => {
        reject(new DOMException("The operation was aborted.", "AbortError"));
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener("abort", onAbort);
    });
  };
}

describe("wasm bridge error messages", () => {
  it("a missing glue rejects init with CORE:WASM_LOAD_ERROR naming initWasm and keeping the cause", async () => {
    const jsUrl = pathToFileURL("/nonexistent/gwen_core.js").href;
    const bridge = new WasmBridgeImpl();
    let caught: unknown;

    try {
      await bridge.init("light", { jsUrl, wasmUrl: MINIMAL_WASM_URL });
    } catch (err: unknown) {
      caught = err;
    } finally {
      bridge._reset();
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
    expect(caught.composable).toBe("initWasm");
    expect(caught.message).toBe(`[initWasm()] Unable to load WASM glue: ${jsUrl}.\n${LOAD_SEE}`);
    expect(caught.cause).toBeInstanceOf(Error);
  });

  it("a fetch timeout message has no [CORE:WASM_TIMEOUT] text", async () => {
    const bridge = new WasmBridgeImpl();
    const { dir, jsUrl } = glueFile();
    const previousFetch = globalThis.fetch;
    let markFetchStarted = (): void => {};
    const fetchStartedP = new Promise<void>((resolve) => {
      markFetchStarted = resolve;
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    globalThis.fetch = hangingFetch(markFetchStarted);
    const pending = bridge
      .init("light", { jsUrl, wasmUrl: "https://wasm.invalid/gwen_core_bg.wasm" })
      .then(
        () => undefined,
        (err: unknown) => err,
      );
    let caught: unknown;

    try {
      await fetchStartedP;
      await vi.advanceTimersByTimeAsync(10_000);
      caught = await pending;
    } finally {
      vi.useRealTimers();
      globalThis.fetch = previousFetch;
      bridge._reset();
      rmSync(dir, { recursive: true, force: true });
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe(CoreErrorCodes.WASM_TIMEOUT);
    expect(caught.composable).toBe("initWasm");
    expect(caught.message).not.toContain("[CORE:WASM_TIMEOUT]");
    expect(caught.message).toBe(TIMEOUT_MESSAGE);
  });

  it("an HTTP failure on the wasm fetch names initWasm and the status", async () => {
    const bridge = new WasmBridgeImpl();
    const { dir, jsUrl } = glueFile();
    const previousFetch = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(new Response(null, { status: 404, statusText: "Not Found" }));
    let caught: unknown;

    try {
      await bridge.init("light", { jsUrl, wasmUrl: "https://wasm.invalid/gwen_core_bg.wasm" });
    } catch (err: unknown) {
      caught = err;
    } finally {
      globalThis.fetch = previousFetch;
      bridge._reset();
      rmSync(dir, { recursive: true, force: true });
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
    expect(caught.message.split("\n")[0]).toBe(
      "[initWasm()] The WASM binary fetch failed with HTTP 404 Not Found.",
    );
  });

  it("an uninitialized bridge throws CORE:WASM_NOT_INITIALIZED with no composable", () => {
    const bridge = new WasmBridgeImpl();
    let caught: unknown;

    try {
      bridge.engine();
    } catch (err: unknown) {
      caught = err;
    } finally {
      bridge._reset();
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe(CoreErrorCodes.WASM_NOT_INITIALIZED);
    expect(caught.composable).toBeUndefined();
    expect(caught.message.split("\n")[0]).toBe("[GWEN] The WASM core is not initialized.");
  });
});
