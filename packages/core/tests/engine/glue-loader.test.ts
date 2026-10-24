/**
 * The wasm glue loads with `import()` on every thread.
 *
 * No module source is built from the glue URL, so a hostile `jsUrl` cannot run code
 * and the page needs no `blob:` entry in its CSP.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GwenError } from "@gwenjs/schema";
import { WasmBridgeImpl } from "../../src/internal";
import { CoreErrorCodes } from "../../src/engine/engine-errors.js";

const MINIMAL_WASM_URL = `data:application/wasm;base64,${Buffer.from(
  "0061736d010000000105016000017f03020100071b01176777656e5f706c7567696e5f6170695f76657273696f6e00000a09010700418089fa000b",
  "hex",
).toString("base64")}`;

const BRIDGE_SOURCE = fileURLToPath(new URL("../../src/engine/wasm-bridge.ts", import.meta.url));
const GLUE_URL = "https://gwenjs.github.io/gwen/api/errors#core-wasm-load-error";
const GLUE_SEE = `See ${GLUE_URL} (CORE:WASM_LOAD_ERROR)`;

afterEach(() => {
  for (const key of Object.keys(globalThis)) {
    if (key.startsWith("__gwenGlue_")) Reflect.deleteProperty(globalThis, key);
  }
});

describe("loadWasmGlue", () => {
  it("source builds no module source", () => {
    const source = readFileSync(BRIDGE_SOURCE, "utf8");

    expect(source).not.toContain("new Blob(");
    expect(source).not.toContain('createElement("script")');
    expect(source).not.toContain("createObjectURL");
  });

  it("init rejects with CORE:WASM_LOAD_ERROR when the glue URL does not load", async () => {
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
    expect(caught.message).toBe(`[GWEN] Unable to load WASM glue: ${jsUrl}.\n${GLUE_SEE}`);
    expect(caught.cause).toBeInstanceOf(Error);
  });

  it("a relative jsUrl with no location rejects with CORE:WASM_LOAD_ERROR", async () => {
    const jsUrl = "relative/gwen_core.js";
    // No `location`: the loader uses `jsUrl` as its own base, and `new URL(jsUrl, jsUrl)` throws.
    const hadLocation = Reflect.has(globalThis, "location");
    const previousLocation = Reflect.get(globalThis, "location");
    if (hadLocation) Reflect.deleteProperty(globalThis, "location");

    const bridge = new WasmBridgeImpl();
    let caught: unknown;

    try {
      await bridge.init("light", { jsUrl, wasmUrl: MINIMAL_WASM_URL });
    } catch (err: unknown) {
      caught = err;
    } finally {
      bridge._reset();
      if (hadLocation) Reflect.set(globalThis, "location", previousLocation);
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
    expect(caught.message).toBe(`[GWEN] Unable to load WASM glue: ${jsUrl}.\n${GLUE_SEE}`);
    expect(caught.cause).toBeInstanceOf(TypeError);
  });

  it("init wraps a plain glue init Error as CORE:WASM_LOAD_ERROR and keeps the cause", async () => {
    const rejected = new Error("glue init failed");
    Reflect.set(globalThis, "__gwenGlue_rejected", rejected);
    const caught = await catchGlue(
      "export default function init() { throw globalThis.__gwenGlue_rejected; }\n",
    );
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.message).toBe(`[GWEN] glue init failed\n${GLUE_SEE}`);
    expect(caught.cause).toBe(rejected);
    expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
  });
  it("init keeps a non-Error glue failure raw and still sets docsUrl", async () => {
    const caught = await catchGlue("export default function init() { throw 'not-an-error'; }\n");
    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) return;
    expect(caught.message).toBe("not-an-error");
    expect(caught.docsUrl).toBe(GLUE_URL);
    expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
  });
});
async function catchGlue(source: string): Promise<unknown> {
  const dir = mkdtempSync(join(tmpdir(), "gwen-glue-"));
  const bridge = new WasmBridgeImpl();
  try {
    const jsUrl = pathToFileURL(join(dir, "glue.mjs")).href;
    writeFileSync(fileURLToPath(jsUrl), source, "utf8");
    await bridge.init("light", { jsUrl, wasmUrl: MINIMAL_WASM_URL });
    return undefined;
  } catch (err: unknown) {
    return err;
  } finally {
    bridge._reset();
    rmSync(dir, { recursive: true, force: true });
  }
}
