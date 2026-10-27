import { describe, expect, it } from "vitest";
import { createEntityId, GwenError } from "@gwenjs/schema";
import { GwenConfigLoadError } from "@gwenjs/app/resolve";
import { CameraEmptyPathError, CameraViewportNotFoundError } from "@gwenjs/camera-core";
import {
  GwenActorError,
  GwenConfigError,
  GwenContextError,
  GwenEngineStateError,
  GwenPluginNotFoundError,
  GwenWasmAbiError,
  GwenWasmError,
  GwenWasmPanicError,
} from "@gwenjs/core";
import { PoolExhaustedError } from "@gwenjs/core/actor";
import { GwenContextError as KitContextError } from "@gwenjs/kit";
import { MathError, MathErrorCodes } from "@gwenjs/math";
import { Physics2DStaleBodyHandleError, Physics2DStaleEntityError } from "@gwenjs/physics2d";
import { Physics3DStaleEntityError } from "@gwenjs/physics3d";
import {
  EmptyLayersError,
  LayerOrderConflictError,
  RendererAlreadyRegisteredError,
  RendererContractVersionError,
  ScreenResizeObserverError,
  ScreenViewportNotFoundError,
  SurfaceInvalidError,
  UnknownLayerError,
} from "@gwenjs/renderer-core";

const rows: ReadonlyArray<{ readonly name: string; make: () => object }> = [
  {
    name: "GwenPluginNotFoundError",
    make: () => new GwenPluginNotFoundError({ pluginName: "physics2d" }),
  },
  {
    name: "GwenWasmError",
    make: () =>
      new GwenWasmError(
        "CORE:ENTITY_LIMIT_REACHED",
        "Entity limit reached: 1",
        "create_entity",
        undefined,
      ),
  },
  {
    name: "GwenWasmAbiError",
    make: () => new GwenWasmAbiError("audio", 1, null),
  },
  {
    name: "GwenWasmPanicError",
    make: () => new GwenWasmPanicError(undefined, new WebAssembly.RuntimeError("unreachable")),
  },
  {
    name: "GwenEngineStateError",
    make: () => new GwenEngineStateError("idle", "advance"),
  },
  {
    name: "GwenConfigError",
    make: () => new GwenConfigError("maxEntities", -1),
  },
  {
    name: "GwenActorError",
    make: () => new GwenActorError("CORE:ACTOR_PLUGIN_NOT_READY", "actor plugin not ready."),
  },
  {
    name: "GwenContextError",
    make: () => new GwenContextError("CORE:OUTSIDE_ACTOR_CONTEXT", "useTransform"),
  },
  {
    name: "PoolExhaustedError",
    make: () => new PoolExhaustedError("Enemy", 1),
  },
  {
    name: "kit.GwenContextError",
    make: () => new KitContextError("CORE:OUTSIDE_ACTOR_CONTEXT", "useTransform"),
  },
  {
    name: "RendererAlreadyRegisteredError",
    make: () => new RendererAlreadyRegisteredError("canvas"),
  },
  {
    name: "RendererContractVersionError",
    make: () => new RendererContractVersionError("canvas", 1, 2),
  },
  {
    name: "EmptyLayersError",
    make: () => new EmptyLayersError("canvas"),
  },
  {
    name: "SurfaceInvalidError",
    make: () => new SurfaceInvalidError("canvas"),
  },
  {
    name: "LayerOrderConflictError",
    make: () => new LayerOrderConflictError("a", "b", 1),
  },
  {
    name: "UnknownLayerError",
    make: () => new UnknownLayerError("hud", "canvas"),
  },
  {
    name: "ScreenResizeObserverError",
    make: () => new ScreenResizeObserverError(),
  },
  {
    name: "ScreenViewportNotFoundError",
    make: () => new ScreenViewportNotFoundError("p3", ["main"]),
  },
  {
    name: "CameraViewportNotFoundError",
    make: () => new CameraViewportNotFoundError("minimap"),
  },
  {
    name: "CameraEmptyPathError",
    make: () => new CameraEmptyPathError(),
  },
  {
    name: "GwenConfigLoadError",
    make: () => new GwenConfigLoadError("missing.", "/gwen.config.ts", undefined),
  },
  {
    name: "Physics2DStaleEntityError",
    make: () => new Physics2DStaleEntityError(createEntityId(1, 1), "step"),
  },
  {
    name: "Physics2DStaleBodyHandleError",
    make: () => new Physics2DStaleBodyHandleError(1, "addBoxCollider"),
  },
  {
    name: "Physics3DStaleEntityError",
    make: () => new Physics3DStaleEntityError(createEntityId(1, 1), "step"),
  },
];

describe("exported error classes", () => {
  it("every exported error class is instanceof GwenError", () => {
    for (const row of rows) expect(row.make(), row.name).toBeInstanceOf(GwenError);
    const math = new MathError(MathErrorCodes.INVALID_HEX_COLOR, 'Invalid hex "zz".', {
      composable: "colorFromHex",
    });
    expect(math).toBeInstanceOf(Error);
    expect(math).not.toBeInstanceOf(GwenError);
  });
});
