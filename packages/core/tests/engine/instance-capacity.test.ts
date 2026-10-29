/**
 * Instantiation failures of both providers (P-263-2).
 * The factory is the boundary. `initSync` throws the chosen value.
 */

import { describe, expect, it } from "vitest";
import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import {
  isolatedProvider,
  sharedProvider,
  type WasmInstanceProvider,
} from "../../src/engine/wasm-instance-provider.js";
import type {
  GwenCoreGlueFactoryModule,
  GwenCoreGlueInstance,
} from "../../src/engine/wasm-bridge-types.js";
import type { GlueContract } from "../../src/engine/wasm-contract.js";

const PROVIDERS = [
  ["shared", sharedProvider],
  ["isolated", isolatedProvider],
] as const;

const HINT = 'Use wasmInstance: "shared", fewer engines per process, or worker threads.';

const CONTRACT: GlueContract = {
  buildId: "capacity-test",
  fingerprint: "capacity-test",
  names: [],
  rawExports: [],
  imports: [],
};

function tinyModule(): WebAssembly.Module {
  return new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
}

function glueShell(initSync: GwenCoreGlueInstance["initSync"]): GwenCoreGlueInstance {
  return {
    get Engine(): GwenCoreGlueInstance["Engine"] {
      throw new Error("Engine is unused");
    },
    initSync,
  };
}

function factory(initSync: GwenCoreGlueInstance["initSync"]): GwenCoreGlueFactoryModule {
  return {
    CONTRACT,
    wasmUrl: new URL("file:///gwen-capacity-test.wasm"),
    createGlue: () => glueShell(initSync),
  };
}

function factoryThrowing(thrown: unknown): GwenCoreGlueFactoryModule {
  return factory(() => {
    throw thrown;
  });
}

function factoryOk(): GwenCoreGlueFactoryModule {
  const memory = new WebAssembly.Memory({ initial: 1 });
  return factory(() => ({ memory }));
}

function capacityLine(mode: "shared" | "isolated", live: number): string {
  return `[initWasm()] Cannot create another WASM instance (mode "${mode}", ${live} live).`;
}

function acquireThrown(provider: WasmInstanceProvider, thrown: unknown): unknown {
  try {
    provider.acquire(tinyModule(), factoryThrowing(thrown));
    return "resolved";
  } catch (error: unknown) {
    return error;
  }
}

function expectGwen(caught: unknown): GwenError {
  expect(caught).toBeInstanceOf(GwenError);
  if (!(caught instanceof GwenError)) throw new Error("expected GwenError");
  return caught;
}

describe("wasm instance capacity", () => {
  it.each(PROVIDERS)(
    "a RangeError from instantiation becomes CORE:WASM_CAPACITY_EXHAUSTED with cause, mode and live count (%s)",
    (mode, provider) => {
      const range = new RangeError("out of memory");
      const caught = expectGwen(acquireThrown(provider, range));
      expect(caught.code).toBe(CoreErrorCodes.WASM_CAPACITY_EXHAUSTED);
      expect(caught.code).toBe("CORE:WASM_CAPACITY_EXHAUSTED");
      expect(caught.cause).toBe(range);
      expect(caught.message.split("\n")[0]).toBe(capacityLine(mode, 0));

      const held: GwenCoreGlueInstance[] = [];
      try {
        const ok = factoryOk();
        held.push(provider.acquire(tinyModule(), ok).glue);
        held.push(provider.acquire(tinyModule(), ok).glue);
        const again = new RangeError("out of memory");
        const second = expectGwen(acquireThrown(provider, again));
        expect(second.cause).toBe(again);
        expect(second.message.split("\n")[0]).toBe(capacityLine(mode, 2));
      } finally {
        for (const glue of held) provider.release(glue);
      }
    },
  );

  it.each(PROVIDERS)(
    "a thrown non-Error value becomes CORE:WASM_CAPACITY_EXHAUSTED (%s)",
    (_mode, provider) => {
      for (const thrown of ["capacity", undefined] as const) {
        const caught = expectGwen(acquireThrown(provider, thrown));
        expect(caught.code).toBe("CORE:WASM_CAPACITY_EXHAUSTED");
        if (thrown !== undefined) expect(caught.cause).toBe(thrown);
      }
    },
  );

  it.each(PROVIDERS)("a LinkError becomes CORE:WASM_LOAD_ERROR (%s)", (_mode, provider) => {
    const thrown = [new WebAssembly.LinkError("link"), new WebAssembly.CompileError("compile")];
    for (const error of thrown) {
      const caught = expectGwen(acquireThrown(provider, error));
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(caught.code).toBe("CORE:WASM_LOAD_ERROR");
      expect(caught.cause).toBe(error);
    }
  });

  it.each(PROVIDERS)("a TypeError is rethrown unchanged (%s)", (_mode, provider) => {
    const thrown = new TypeError("not a capacity error");
    const caught = acquireThrown(provider, thrown);
    expect(caught).toBe(thrown);
    expect(caught).not.toBeInstanceOf(GwenError);
  });

  it.each(PROVIDERS)(
    "the hint names the fallback in dev and is absent in prod (%s)",
    (_mode, provider) => {
      const caught = expectGwen(acquireThrown(provider, new RangeError("out of memory")));
      expect(caught.hint).toBe(__GWEN_DEV__ ? HINT : undefined);
    },
  );

  it.each(PROVIDERS)(
    "a double release or a release of an unknown glue does not change the live count (%s)",
    (mode, provider) => {
      const ok = factoryOk();
      const glue = provider.acquire(tinyModule(), ok).glue;
      provider.release(glue);
      provider.release(glue);
      provider.release(glueShell(() => ({ memory: new WebAssembly.Memory({ initial: 1 }) })));
      const cleared = expectGwen(acquireThrown(provider, new RangeError("out of memory")));
      expect(cleared.message.split("\n")[0]).toBe(capacityLine(mode, 0));

      const held = provider.acquire(tinyModule(), ok).glue;
      try {
        const again = expectGwen(acquireThrown(provider, new RangeError("out of memory")));
        expect(again.message.split("\n")[0]).toBe(capacityLine(mode, 1));
      } finally {
        provider.release(held);
      }
    },
  );

  it("a failed isolated acquire does not count as live", () => {
    const first = expectGwen(acquireThrown(isolatedProvider, new RangeError("out of memory")));
    const second = expectGwen(acquireThrown(isolatedProvider, new RangeError("again")));
    const line = capacityLine("isolated", 0);
    expect(first.message.split("\n")[0]).toBe(line);
    expect(second.message.split("\n")[0]).toBe(line);
  });
});
