/**
 * WasmModuleRunner without an engine.
 * Each test loads a real wasm binary and reads the handle back.
 */

import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";
import { createEngine } from "../../src/index";
import { CoreErrorCodes } from "../../src/engine/engine-errors";
import { createErrorBus } from "../../src/engine/error-bus";
import { EngineMemory } from "../../src/engine/engine-memory";
import { WasmBridgeImpl } from "../../src/engine/wasm-bridge";
import { DisposableRegistry } from "../../src/disposable";
import { TRANSFORM_STRIDE } from "../../src/hooks/wasm/shared-memory";
import { WasmModuleRunner, type WasmModuleRunnerDeps } from "../../src/engine/wasm-module-runner";

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    absent: WebAssembly.Exports;
    audio: WebAssembly.Exports;
  }
}

const EMPTY_WASM = Uint8Array.from([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]);

interface Served {
  url: string;
  hits: () => number;
  close: () => Promise<void>;
}

function listen(server: Server): Promise<void> {
  server.listen(0, "127.0.0.1");
  return once(server, "listening").then(() => undefined);
}

async function serve(body: Uint8Array, status = 200): Promise<Served> {
  let hits = 0;
  const server = createServer((_request, response) => {
    hits += 1;
    response.statusCode = status;
    response.setHeader("content-type", "application/wasm");
    response.end(body);
  });
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("test server has no port");
  }
  return {
    url: `http://127.0.0.1:${address.port}/mod.wasm`,
    hits: () => hits,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

interface Report {
  hook: string;
  code?: string;
  source?: string;
  message?: string;
  targetId?: string;
}

function emptyModuleUrl(): string {
  return `data:application/wasm;base64,${Buffer.from(EMPTY_WASM).toString("base64")}`;
}

/** Settlement order of one call: the reaction, then three microtasks queued immediately. */
async function orderOf(start: () => Promise<unknown>): Promise<string[]> {
  const order: string[] = [];
  const pending = start().then(
    () => {
      order.push("load");
    },
    () => {
      order.push("load");
    },
  );
  queueMicrotask(() => order.push("t1"));
  queueMicrotask(() => order.push("t2"));
  queueMicrotask(() => order.push("t3"));
  await pending;
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  return order;
}

/** Microtasks until the call's reaction runs. A direct async return is 1. */
async function ticksOf(start: () => Promise<unknown>): Promise<number> {
  let ticks = 0;
  let settled = false;
  const pending = start().then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise<void>((resolve) => {
    function spin(): void {
      ticks += 1;
      if (settled) resolve();
      else queueMicrotask(spin);
    }
    queueMicrotask(spin);
  });
  await pending;
  return ticks;
}

function open(patch: Partial<WasmModuleRunnerDeps> = {}) {
  const calls: string[] = [];
  const reports: Report[] = [];
  const bridge = new WasmBridgeImpl();
  const memory = new EngineMemory(bridge, createErrorBus());
  const runner = new WasmModuleRunner({
    bridge,
    maxEntities: 4,
    disposables: new DisposableRegistry(),
    memory,
    isFaulted: () => false,
    isIsolated: () => false,
    frame: () => 7,
    reportCaught(_error, hook, forced) {
      const row: Report = { hook };
      if (forced?.code !== undefined) row.code = forced.code;
      if (forced?.source !== undefined) row.source = forced.source;
      if (forced?.message !== undefined) row.message = forced.message;
      if (forced?.target?.id !== undefined) row.targetId = forced.target.id;
      reports.push(row);
    },
    publish() {},
    ...patch,
    assertState(method) {
      calls.push(method);
      patch.assertState?.(method);
    },
  });
  return { runner, calls, reports, bridge, memory };
}

describe("WasmModuleRunner", () => {
  it("constructs without createEngine and get of an unknown name throws module not found", () => {
    const { runner, calls } = open();

    let caught: unknown;
    try {
      runner.get("absent");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw caught;
    expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
    expect(caught.message).toBe(
      `[GWEN] getWasmModule("absent"): no WASM module loaded under that name. ` +
        `Call engine.loadWasmModule({ name: "absent", url: ... }) first.`,
    );
    expect(calls).toEqual([]);
  });

  it("constructs without createEngine and load then get returns the same handle", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner, calls } = open();

      const loaded = await runner.load({ name: "audio", url: served.url });
      const again = await runner.load({ name: "audio", url: served.url });
      const fetched = runner.get("audio");

      expect(again).toBe(loaded);
      expect(fetched).toBe(loaded);
      expect(loaded.name).toBe("audio");
      expect(loaded.exports).toEqual({});
      expect(loaded.memory).toBeUndefined();
      expect(served.hits()).toBe(1);
      expect(calls).toEqual(["loadWasmModule", "loadWasmModule"]);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and a second runner does not see the first module", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const first = open();
      const second = open();
      await first.runner.load({ name: "audio", url: served.url });

      let caught: unknown;
      try {
        second.runner.get("audio");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
      expect(served.hits()).toBe(1);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and load while faulted does not store the module", async () => {
    const served = await serve(EMPTY_WASM);
    const gate = new GwenError(
      CoreErrorCodes.INVALID_STATE_TRANSITION,
      "[GwenEngine] loadWasmModule() is not allowed while the engine is faulted.",
    );
    try {
      const { runner, calls } = open({
        assertState() {
          throw gate;
        },
      });
      let caught: unknown;
      try {
        await runner.load({ name: "audio", url: served.url });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBe(gate);
      expect(served.hits()).toBe(0);
      expect(calls).toEqual(["loadWasmModule"]);
      let missing: unknown;
      try {
        runner.get("audio");
      } catch (error) {
        missing = error;
      }
      expect(missing).toBeInstanceOf(GwenError);
      if (!(missing instanceof GwenError)) throw missing;
      expect(missing.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and stepAll calls modules in registration order", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner, calls } = open();
      const seen: string[] = [];
      await runner.load({
        name: "first",
        url: served.url,
        step: () => {
          seen.push("first");
        },
      });
      await runner.load({
        name: "second",
        url: served.url,
        step: (handle, dt) => {
          seen.push(`${handle.name}:${dt}`);
        },
      });

      runner.stepAll(0.25);

      expect(seen).toEqual(["first", "second:0.25"]);
      expect(calls).toEqual(["loadWasmModule", "loadWasmModule"]);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and a throwing step reports the module and the next one still runs", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner, reports } = open();
      const seen: string[] = [];
      await runner.load({
        name: "boom",
        url: served.url,
        step: () => {
          throw new Error("step blew up");
        },
      });
      await runner.load({
        name: "next",
        url: served.url,
        step: () => {
          seen.push("next");
        },
      });

      runner.stepAll(1);

      expect(seen).toEqual(["next"]);
      expect(reports).toEqual([
        {
          hook: "wasm",
          code: CoreErrorCodes.FRAME_LOOP_ERROR,
          source: "wasm:boom",
          message: `WASM module "boom" step failed: step blew up`,
          targetId: "wasm:boom",
        },
      ]);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and an isolated module is skipped", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner } = open({
        isIsolated: (id) => id === "wasm:skip",
      });
      const seen: string[] = [];
      await runner.load({
        name: "skip",
        url: served.url,
        step: () => {
          seen.push("skip");
        },
      });
      await runner.load({
        name: "keep",
        url: served.url,
        step: () => {
          seen.push("keep");
        },
      });

      runner.stepAll(1);

      expect(seen).toEqual(["keep"]);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and stepAll while faulted does not call step", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner, reports } = open({
        isFaulted: () => true,
      });
      const seen: string[] = [];
      await runner.load({
        name: "audio",
        url: served.url,
        step: () => {
          seen.push("audio");
        },
      });

      runner.stepAll(1);

      expect(seen).toEqual([]);
      expect(reports).toEqual([]);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and clear drops the module so the next load fetches again", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner } = open();
      await runner.load({ name: "audio", url: served.url });

      runner.clear();

      let caught: unknown;
      try {
        runner.get("audio");
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_NOT_FOUND);

      const reloaded = await runner.load({ name: "audio", url: served.url });
      expect(reloaded.name).toBe("audio");
      expect(served.hits()).toBe(2);
      runner.clear();
      expect(served.hits()).toBe(2);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and a short transform region throws before fetch", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner } = open({ maxEntities: 2 });
      let caught: unknown;
      try {
        await runner.load({
          name: "mod",
          url: served.url,
          transformRegion: "poses",
          memory: {
            regions: [{ name: "poses", byteOffset: 0, byteLength: 1, type: "u8" }],
          },
        });
      } catch (error) {
        caught = error;
      }

      const required = 2 * TRANSFORM_STRIDE;
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_REGION_TOO_SMALL);
      expect(caught.message).toBe(
        `[GWEN] loadWasmModule("mod"): transform region "poses" is 1 bytes; ${required} bytes are required.`,
      );
      expect(served.hits()).toBe(0);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and an unknown transform region throws region invalid", async () => {
    const { runner } = open();
    let caught: unknown;
    try {
      await runner.load({
        name: "mod",
        url: "http://127.0.0.1:1/absent.wasm",
        transformRegion: "poses",
        memory: { regions: [] },
      });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) throw caught;
    expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_REGION_INVALID);
    expect(caught.message).toBe(
      `[GWEN] loadWasmModule("mod"): transform region "poses" is invalid: unknown region name.`,
    );
  });

  it("constructs without createEngine and a channel without exported memory throws", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner } = open();
      let caught: unknown;
      try {
        await runner.load({
          name: "mod",
          url: served.url,
          channels: [{ name: "commands", direction: "ts→wasm", capacity: 1, itemByteSize: 4 }],
        });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_NO_MEMORY);
      expect(caught.message).toBe(
        `[GWEN] loadWasmModule("mod"): channel 'commands' declared but ` +
          `the WASM binary does not export "memory". ` +
          `Add "(export \\"memory\\" (memory ...))" to your WASM module.`,
      );
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and a failed fetch throws wasm load error", async () => {
    const served = await serve(EMPTY_WASM, 404);
    try {
      const { runner } = open();
      let caught: unknown;
      try {
        await runner.load({ name: "mod", url: served.url });
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.message).toContain("status 404");
      expect(caught.message).toContain(served.url);
    } finally {
      await served.close();
    }
  });

  it("constructs without createEngine and a missing region on the handle throws region not found", async () => {
    const served = await serve(EMPTY_WASM);
    try {
      const { runner } = open();
      const handle = await runner.load({ name: "mod", url: served.url });
      let caught: unknown;
      try {
        handle.region("poses");
      } catch (error) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.WASM_REGION_NOT_FOUND);
      expect(caught.message).toBe(
        `[GWEN] WASM region 'poses' not found in module 'mod'. ` +
          `Declare it in WasmModuleOptions.memory.regions.`,
      );
    } finally {
      await served.close();
    }
  });

  it("settles a duplicate load and a faulted load on the next microtask", async () => {
    const url = emptyModuleUrl();
    const dedupe = await createEngine();
    try {
      const first = await dedupe.loadWasmModule({ name: "audio", url });
      const dedupeOrder = await orderOf(() => dedupe.loadWasmModule({ name: "audio", url }));
      const dedupeTicks = await ticksOf(() => dedupe.loadWasmModule({ name: "audio", url }));

      expect(dedupe.getWasmModule("audio")).toBe(first);
      expect(dedupeOrder).toEqual(["load", "t1", "t2", "t3"]);
      expect(dedupeTicks).toBe(1);
    } finally {
      await dedupe.stop();
    }

    const faulted = await createEngine();
    try {
      faulted.hooks.hook("engine:update", () => {
        throw new WebAssembly.RuntimeError("panic");
      });
      await faulted.startExternal();
      await faulted.advance(1 / 60);
      expect(faulted.state).toBe("faulted");

      let caught: unknown;
      try {
        await faulted.loadWasmModule({ name: "audio", url });
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) throw caught;
      expect(caught.code).toBe(CoreErrorCodes.INVALID_STATE_TRANSITION);
      expect(caught.message).toBe(
        "[GwenEngine] loadWasmModule() is not allowed while the engine is faulted.",
      );

      const faultOrder = await orderOf(() => faulted.loadWasmModule({ name: "audio", url }));
      const faultTicks = await ticksOf(() => faulted.loadWasmModule({ name: "audio", url }));
      expect(faultOrder).toEqual(["load", "t1", "t2", "t3"]);
      expect(faultTicks).toBe(1);
    } finally {
      await faulted.stop();
    }
  });
});
