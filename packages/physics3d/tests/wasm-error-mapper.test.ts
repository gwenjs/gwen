/**
 * `callPhysics3DExport` and `mapPhysics3DError` map what a physics3d export throws.
 * A `PHYSICS3D:` code and the core codes become `GwenWasmError`, a trap becomes
 * `GwenWasmPanicError`, anything else is returned as it was.
 */
import { describe, expect, it } from "vitest";
import { GwenWasmError, GwenWasmPanicError } from "@gwenjs/core";

import { buildLayerRegistry, normalizePhysics3DConfig } from "../src/config";
import { createPluginContext, type PluginContext } from "../src/plugin/plugin-context";
import { callPhysics3DExport, mapPhysics3DError } from "../src/plugin/wasm-errors";

/** An `Error` with the `code` property a wasm-bindgen `Result` throw carries. */
function codedError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function makeContext(): PluginContext {
  const cfg = normalizePhysics3DConfig({});
  return createPluginContext(cfg, buildLayerRegistry(cfg.layers));
}

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (err: unknown) {
    return err;
  }
  return undefined;
}

function requireWasmError(err: unknown, code: string, exportName: string): GwenWasmError {
  expect(err).toBeInstanceOf(GwenWasmError);
  if (!(err instanceof GwenWasmError)) throw new Error("expected GwenWasmError");
  expect(err.code).toBe(code);
  expect(err.exportName).toBe(exportName);
  return err;
}

describe("callPhysics3DExport and mapPhysics3DError", () => {
  const ctx = makeContext();

  it("maps a PHYSICS3D code to GwenWasmError with the export name and the original as cause", () => {
    const original = codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
    const err = caught(() =>
      callPhysics3DExport(ctx, "physics3d_remove_body", () => {
        throw original;
      }),
    );
    const wasmError = requireWasmError(err, "PHYSICS3D:BODY_NOT_FOUND", "physics3d_remove_body");
    expect(wasmError.cause).toBe(original);
    expect(wasmError.message.split("\n")[0]).toBe("no body registered for slot 5.");
  });

  it("a Rust text ending in ? or ! gets no second period", () => {
    const line = (message: string): string => {
      const mapped = mapPhysics3DError(
        ctx,
        codedError("PHYSICS3D:BODY_NOT_FOUND", message),
        "physics3d_remove_body",
      );
      expect(mapped).toBeInstanceOf(GwenWasmError);
      if (!(mapped instanceof GwenWasmError)) return "";
      return mapped.message.split("\n")[0] ?? "";
    };
    expect(line("really?")).toBe("really?");
    expect(line("stop!")).toBe("stop!");
    expect(line("no body registered for slot 5")).toBe("no body registered for slot 5.");
  });

  it("returns an already mapped GwenWasmError unchanged", () => {
    const original = codedError("PHYSICS3D:BODY_NOT_FOUND", "no body registered for slot 5");
    const once = mapPhysics3DError(ctx, original, "physics3d_remove_body");
    expect(once).toBeInstanceOf(GwenWasmError);
    expect(mapPhysics3DError(ctx, once, "physics3d_remove_body")).toBe(once);
  });

  it("maps CORE:INVALID_SHARED_BUFFER from the overlap export", () => {
    const err = caught(() =>
      callPhysics3DExport(ctx, "physics3d_overlap_shape", () => {
        throw codedError("CORE:INVALID_SHARED_BUFFER", "invalid shared buffer: ptr 0, len 0");
      }),
    );
    requireWasmError(err, "CORE:INVALID_SHARED_BUFFER", "physics3d_overlap_shape");
  });

  it("maps a trap to GwenWasmPanicError", () => {
    const err = caught(() =>
      callPhysics3DExport(ctx, "physics3d_cast_ray", () => {
        throw new WebAssembly.RuntimeError("unreachable");
      }),
    );
    expect(err).toBeInstanceOf(GwenWasmPanicError);
    if (!(err instanceof GwenWasmPanicError)) throw new Error("expected GwenWasmPanicError");
    expect(err.exportName).toBe("physics3d_cast_ray");
  });

  it("returns an error without a known code unchanged", () => {
    const foreign = codedError("PHYSICS2D:BODY_NOT_FOUND", "not a physics3d code");
    expect(mapPhysics3DError(ctx, foreign, "physics3d_remove_body")).toBe(foreign);
    const plain = new TypeError("not a function");
    expect(mapPhysics3DError(ctx, plain, "physics3d_remove_body")).toBe(plain);
  });
});
