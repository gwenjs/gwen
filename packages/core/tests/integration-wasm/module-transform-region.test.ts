import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes } from "../../src/engine/engine-errors.js";
import type { WasmModuleOptions } from "../../src/engine/engine-types.js";
import type { RealEngineHandle } from "../../src/testing/create-real-engine.js";
import {
  NO_MEMORY_WASM,
  TRANSFORM_READER_ABI_WASM,
  TRANSFORM_READER_EXPORT_WASM,
  TRANSFORM_READER_SHIFT_WASM,
  TRANSFORM_READER_START_WASM,
  TRANSFORM_READER_WASM,
  wasmDataUrl,
} from "./fixtures/transform-reader.js";
import { createRealEngine } from "./harness.js";

const MAX_ENTITIES = 64;
const REQUIRED_BYTES = MAX_ENTITIES * 32;
const REGION_OFFSET = 1024;

interface TransformReaderExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  step: (dt: number) => void;
  read_x: () => number;
  read_y: () => number;
  ptr: () => number;
  scribble: () => void;
  grow: () => number;
}

interface ExportFormExports extends TransformReaderExports {
  gwen_transforms_ptr: () => number;
}

interface StartCachedExports extends WebAssembly.Exports {
  memory: WebAssembly.Memory;
  cached_ptr: () => number;
  ptr: () => number;
  gwen_transforms_ptr: () => number;
}

declare module "../../src/engine/engine-types.js" {
  interface GwenWasmModules {
    reader: TransformReaderExports;
    "too-small": TransformReaderExports;
    plain: TransformReaderExports;
    scribble: TransformReaderExports;
    grow: TransformReaderExports;
    "core-grow": TransformReaderExports;
    "bad-name": TransformReaderExports;
    "offset-zero": TransformReaderExports;
    "offset-two": TransformReaderExports;
    "past-end": TransformReaderExports;
    "no-memory": WebAssembly.Exports;
    "export-form": ExportFormExports;
    "start-cache": StartCachedExports;
    "second-frame": TransformReaderExports;
    "offset-mismatch": WebAssembly.Exports;
    "abi-before-region": WebAssembly.Exports;
  }
}

function region(byteOffset: number, byteLength: number) {
  return { name: "transforms", byteOffset, byteLength, type: "f32" as const };
}

function readerOptions(
  name: keyof GwenWasmModulesReader,
  bytes: Uint8Array,
  transformRegion: string | undefined,
  byteOffset: number,
  byteLength: number,
): WasmModuleOptions<TransformReaderExports> {
  const options: WasmModuleOptions<TransformReaderExports> = {
    name,
    url: wasmDataUrl(bytes),
    memory: { regions: [region(byteOffset, byteLength)] },
    step: (handle, dt) => {
      handle.exports.step(dt);
    },
  };
  if (transformRegion !== undefined) {
    return { ...options, transformRegion };
  }
  return options;
}

interface GwenWasmModulesReader {
  reader: TransformReaderExports;
  "too-small": TransformReaderExports;
  plain: TransformReaderExports;
  scribble: TransformReaderExports;
  grow: TransformReaderExports;
  "core-grow": TransformReaderExports;
  "bad-name": TransformReaderExports;
  "offset-zero": TransformReaderExports;
  "offset-two": TransformReaderExports;
  "past-end": TransformReaderExports;
  "no-memory": WebAssembly.Exports;
  "export-form": ExportFormExports;
  "start-cache": StartCachedExports;
  "second-frame": TransformReaderExports;
  "offset-mismatch": WebAssembly.Exports;
  "abi-before-region": WebAssembly.Exports;
}

async function withEngine(run: (started: RealEngineHandle) => Promise<void>): Promise<void> {
  const started = await createRealEngine({ variant: "light", maxEntities: MAX_ENTITIES });
  try {
    await run(started);
  } finally {
    await started.dispose();
  }
}

function placeOrigin(started: RealEngineHandle): void {
  const entity = started.bridge.createEntity();
  expect(entity.index).toBe(0);
  started.bridge.engine().add_entity_transform(entity.index, 3.5, -2, 0, 1, 1);
}

describe("module transform region", () => {
  it("the fixture bytes are valid wasm", () => {
    expect(WebAssembly.validate(TRANSFORM_READER_WASM)).toBe(true);
    expect(WebAssembly.validate(TRANSFORM_READER_EXPORT_WASM)).toBe(true);
    expect(WebAssembly.validate(TRANSFORM_READER_START_WASM)).toBe(true);
    expect(WebAssembly.validate(TRANSFORM_READER_SHIFT_WASM)).toBe(true);
    expect(WebAssembly.validate(TRANSFORM_READER_ABI_WASM)).toBe(true);
    expect(WebAssembly.validate(NO_MEMORY_WASM)).toBe(true);
  });

  it("reads the moved entity through the region pointer", async () => {
    await withEngine(async (started) => {
      placeOrigin(started);
      const handle = await started.engine.loadWasmModule(
        readerOptions("reader", TRANSFORM_READER_WASM, "transforms", REGION_OFFSET, REQUIRED_BYTES),
      );
      await started.advance(1);
      const wasm = started.bridge.engine();
      expect(handle.exports.ptr()).toBe(REGION_OFFSET);
      expect(handle.exports.read_x()).toBe(wasm.get_entity_world_x(0));
      expect(handle.exports.read_y()).toBe(wasm.get_entity_world_y(0));
    });
  });

  it("copies the moved entity again on the second frame", async () => {
    await withEngine(async (started) => {
      placeOrigin(started);
      const handle = await started.engine.loadWasmModule(
        readerOptions(
          "second-frame",
          TRANSFORM_READER_WASM,
          "transforms",
          REGION_OFFSET,
          REQUIRED_BYTES,
        ),
      );
      const bridge = started.bridge;
      const previous = bridge.syncTransformsToBuffer.bind(bridge);
      let fills = 0;
      bridge.syncTransformsToBuffer = (ptr: number, maxEntities: number): void => {
        fills += 1;
        previous(ptr, maxEntities);
      };
      await started.advance(1);
      started.bridge.engine().set_entity_local_position(0, 9, 8);
      await started.advance(1);
      const wasm = started.bridge.engine();
      expect(handle.exports.read_x()).toBe(9);
      expect(handle.exports.read_y()).toBe(8);
      expect(handle.exports.read_x()).toBe(wasm.get_entity_world_x(0));
      expect(handle.exports.read_y()).toBe(wasm.get_entity_world_y(0));
      expect(fills).toBe(2);
    });
  });

  it("rejects a region smaller than maxEntities times stride", async () => {
    await withEngine(async (started) => {
      let caught: unknown;
      try {
        await started.engine.loadWasmModule(
          readerOptions("too-small", TRANSFORM_READER_WASM, "transforms", REGION_OFFSET, 2047),
        );
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_REGION_TOO_SMALL);
      expect(caught.message).toContain(String(REQUIRED_BYTES));
      expect(() => started.engine.getWasmModule("too-small")).toThrow(/too-small/);
      await started.advance(1);
      expect(started.engine.state).not.toBe("faulted");
    });
  });

  it("returns pointer 0 when no transform region is declared", async () => {
    await withEngine(async (started) => {
      const handle = await started.engine.loadWasmModule(
        readerOptions("plain", TRANSFORM_READER_WASM, undefined, REGION_OFFSET, REQUIRED_BYTES),
      );
      expect(handle.exports.ptr()).toBe(0);
    });
  });

  it("keeps a module scribble out of core and restores the copy", async () => {
    await withEngine(async (started) => {
      placeOrigin(started);
      const handle = await started.engine.loadWasmModule(
        readerOptions(
          "scribble",
          TRANSFORM_READER_WASM,
          "transforms",
          REGION_OFFSET,
          REQUIRED_BYTES,
        ),
      );
      await started.advance(1);
      handle.exports.scribble();
      await started.advance(1);
      const wasm = started.bridge.engine();
      expect(wasm.get_entity_world_x(0)).toBe(3.5);
      expect(wasm.get_entity_world_y(0)).toBe(-2);
      expect(handle.exports.read_x()).toBe(wasm.get_entity_world_x(0));
      expect(handle.exports.read_y()).toBe(wasm.get_entity_world_y(0));
    });
  });

  it("reads the right values the frame after the module grows", async () => {
    await withEngine(async (started) => {
      placeOrigin(started);
      let grown = false;
      const handle = await started.engine.loadWasmModule<TransformReaderExports>({
        ...readerOptions(
          "grow",
          TRANSFORM_READER_WASM,
          "transforms",
          REGION_OFFSET,
          REQUIRED_BYTES,
        ),
        step: (moduleHandle, dt) => {
          if (!grown) {
            moduleHandle.exports.grow();
            grown = true;
          }
          moduleHandle.exports.step(dt);
        },
      });
      await started.advance(1);
      await started.advance(1);
      const wasm = started.bridge.engine();
      expect(grown).toBe(true);
      expect(handle.exports.read_x()).toBe(wasm.get_entity_world_x(0));
      expect(handle.exports.read_y()).toBe(wasm.get_entity_world_y(0));
    });
  });

  it("reads the right values after core memory grows", async () => {
    await withEngine(async (started) => {
      placeOrigin(started);
      const handle = await started.engine.loadWasmModule(
        readerOptions(
          "core-grow",
          TRANSFORM_READER_WASM,
          "transforms",
          REGION_OFFSET,
          REQUIRED_BYTES,
        ),
      );
      await started.advance(1);
      started.bridge.getLinearMemory()!.grow(1);
      await started.advance(1);
      const wasm = started.bridge.engine();
      expect(handle.exports.read_x()).toBe(wasm.get_entity_world_x(0));
      expect(handle.exports.read_y()).toBe(wasm.get_entity_world_y(0));
    });
  });

  it("rejects each invalid region at load and keeps the engine running", async () => {
    const cases: Array<{
      name: GwenWasmModulesReaderKey;
      bytes: Uint8Array;
      offset: number;
      length: number;
      regionName: string;
    }> = [
      {
        name: "bad-name",
        bytes: TRANSFORM_READER_WASM,
        offset: REGION_OFFSET,
        length: REQUIRED_BYTES,
        regionName: "missing",
      },
      {
        name: "offset-zero",
        bytes: TRANSFORM_READER_WASM,
        offset: 0,
        length: REQUIRED_BYTES,
        regionName: "transforms",
      },
      {
        name: "offset-two",
        bytes: TRANSFORM_READER_WASM,
        offset: 2,
        length: REQUIRED_BYTES,
        regionName: "transforms",
      },
      {
        name: "past-end",
        bytes: TRANSFORM_READER_WASM,
        offset: 65532,
        length: REQUIRED_BYTES,
        regionName: "transforms",
      },
      {
        name: "no-memory",
        bytes: NO_MEMORY_WASM,
        offset: REGION_OFFSET,
        length: REQUIRED_BYTES,
        regionName: "transforms",
      },
    ];
    for (const item of cases) {
      await withEngine(async (started) => {
        let caught: unknown;
        try {
          await started.engine.loadWasmModule({
            name: item.name,
            url: wasmDataUrl(item.bytes),
            memory: { regions: [region(item.offset, item.length)] },
            transformRegion: item.regionName,
          });
        } catch (error: unknown) {
          caught = error;
        }
        expect(caught, item.name).toBeInstanceOf(GwenError);
        if (!(caught instanceof GwenError)) {
          throw new Error(`${item.name}: expected GwenError`);
        }
        expect(caught.code, item.name).toBe(CoreErrorCodes.WASM_MODULE_REGION_INVALID);
        expect(() => started.engine.getWasmModule(item.name)).toThrow();
        await started.advance(1);
        expect(started.engine.state).not.toBe("faulted");
      });
    }
  });

  it("resolves the pointer from gwen_transforms_ptr", async () => {
    await withEngine(async (started) => {
      placeOrigin(started);
      const handle = await started.engine.loadWasmModule<ExportFormExports>({
        name: "export-form",
        url: wasmDataUrl(TRANSFORM_READER_EXPORT_WASM),
        memory: { regions: [{ ...region(0, REQUIRED_BYTES) }] },
        transformRegion: "transforms",
        step: (moduleHandle, dt) => {
          moduleHandle.exports.step(dt);
        },
      });
      await started.advance(1);
      const wasm = started.bridge.engine();
      expect(handle.exports.gwen_transforms_ptr()).toBe(REGION_OFFSET);
      expect(handle.exports.ptr()).toBe(REGION_OFFSET);
      expect(handle.exports.read_x()).toBe(wasm.get_entity_world_x(0));
      expect(handle.exports.read_y()).toBe(wasm.get_entity_world_y(0));
    });
  });

  it("gives start the same pointer as later calls", async () => {
    await withEngine(async (started) => {
      const handle = await started.engine.loadWasmModule<StartCachedExports>({
        name: "start-cache",
        url: wasmDataUrl(TRANSFORM_READER_START_WASM),
        memory: { regions: [region(0, REQUIRED_BYTES)] },
        transformRegion: "transforms",
      });
      expect(handle.exports.gwen_transforms_ptr()).toBe(REGION_OFFSET);
      expect(handle.exports.cached_ptr()).toBe(REGION_OFFSET);
      expect(handle.exports.ptr()).toBe(REGION_OFFSET);
    });
  });

  it("rejects a probe offset that differs from the instance offset", async () => {
    await withEngine(async (started) => {
      let caught: unknown;
      try {
        await started.engine.loadWasmModule({
          name: "offset-mismatch",
          url: wasmDataUrl(TRANSFORM_READER_SHIFT_WASM),
          memory: { regions: [region(64, REQUIRED_BYTES)] },
          transformRegion: "transforms",
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe(CoreErrorCodes.WASM_MODULE_REGION_INVALID);
      expect(() => started.engine.getWasmModule("offset-mismatch")).toThrow();
      await started.advance(1);
      expect(started.engine.state).not.toBe("faulted");
    });
  });

  it("checks the plugin API version before the region offset", async () => {
    await withEngine(async (started) => {
      let caught: unknown;
      try {
        await started.engine.loadWasmModule({
          name: "abi-before-region",
          url: wasmDataUrl(TRANSFORM_READER_ABI_WASM),
          memory: { regions: [region(REGION_OFFSET, REQUIRED_BYTES)] },
          transformRegion: "transforms",
          versionPolicy: "throw",
        });
      } catch (error: unknown) {
        caught = error;
      }
      if (!(caught instanceof Error)) {
        throw new Error("expected Error");
      }
      expect(caught.message).toContain("API version");
      expect(() => started.engine.getWasmModule("abi-before-region")).toThrow();
      await started.advance(1);
      expect(started.engine.state).not.toBe("faulted");
    });
  });

  it("throws GwenError when the module bytes do not compile", async () => {
    await withEngine(async (started) => {
      let caught: unknown;
      try {
        await started.engine.loadWasmModule({
          name: "plain",
          url: "data:application/wasm;base64,AAAA",
        });
      } catch (error: unknown) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) {
        throw new Error("expected GwenError");
      }
      expect(caught.code).toBe(CoreErrorCodes.WASM_LOAD_ERROR);
      expect(() => started.engine.getWasmModule("plain")).toThrow();
    });
  });
});

type GwenWasmModulesReaderKey = keyof GwenWasmModulesReader;
