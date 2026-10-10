import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import * as core from "../src/index";
import * as internal from "../src/internal";
import * as system from "../src/system/index";
import * as scene from "../src/scene/index";
import * as actor from "../src/actor/index";
import * as physics2d from "../../physics2d/src/index";
import * as physics2dInternal from "../../physics2d/src/internal";
import * as physics3d from "../../physics3d/src/index";
import * as physics3dInternal from "../../physics3d/src/internal";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

describe("API surface (RFC-V2-013)", () => {
  it("exports stable V2 runtime entrypoints", () => {
    expect(typeof core.createEngine).toBe("function");
    expect(typeof core.setupGwen).toBe("function");
    expect(typeof core.emit).toBe("function");
    expect(typeof system.defineSystem).toBe("function");
    expect(typeof scene.defineScene).toBe("function");
    expect(typeof actor.definePrefab).toBe("function");
    expect(typeof core.GwenEngineStateError).toBe("function");
    expect(core.CoreErrorCodes.INVALID_STATE_TRANSITION).toBe("CORE:INVALID_STATE_TRANSITION");
    expect(typeof actor.onEnable).toBe("function");
    expect(typeof actor.onDisable).toBe("function");
  });

  it("keeps internals off the root and the actor entry", () => {
    expect("getWasmBridge" in core).toBe(false);
    expect("WasmBridgeImpl" in core).toBe(false);
    expect("detectCoreVariant" in core).toBe(false);
    expect("detectSharedMemoryRequired" in core).toBe(false);
    expect("engineContext" in core).toBe(false);
    expect("executeAsync" in core).toBe(false);
    expect("emit" in actor).toBe(false);
    expect("_getActorEntityId" in actor).toBe(false);
  });

  it("exposes internals from @gwenjs/core/internal", () => {
    expect(typeof internal.getWasmBridge).toBe("function");
    expect(typeof internal.WasmBridgeImpl).toBe("function");
    expect(typeof internal.detectCoreVariant).toBe("function");
    expect("detectSharedMemoryRequired" in internal).toBe(false);
    expect(typeof internal.engineContext).toBe("object");
    expect(typeof internal.executeAsync).toBe("function");
    expect(typeof internal._getActorEntityId).toBe("function");
  });

  it("exposes per-engine state helpers and drops the global string pool (#59)", () => {
    expect(typeof core.createEngineLocal).toBe("function");
    expect(typeof internal.stringPoolFor).toBe("function");
    expect(typeof internal._getActorContext).toBe("function");
    expect("GlobalStringPoolManager" in internal).toBe(false);
    expect("GlobalStringPoolManager" in core).toBe(false);
  });

  it("drops the module-global physics helpers from every entry (#59)", () => {
    for (const name of [
      "_dispatchContactEvent",
      "_clearContactCallbacks",
      "_setCurrentContactEntityId",
    ]) {
      expect(name in physics2d).toBe(false);
      expect(name in physics2dInternal).toBe(false);
    }
    expect("_clearBvhCache" in physics3d).toBe(false);
    expect("_clearBvhCache" in physics3dInternal).toBe(false);
  });

  it("does not expose legacy V1 engine infrastructure", () => {
    expect("Engine" in core).toBe(false);
    expect("PluginManager" in core).toBe(false);
    expect("ServiceLocator" in core).toBe(false);
    expect("EngineAPIImpl" in core).toBe(false);
    expect("createEngineAPI" in core).toBe(false);
    expect("loadWasmPlugin" in core).toBe(false);
    expect("PluginDataBus" in core).toBe(false);
    expect("isWasmPlugin" in core).toBe(false);
    expect("ConfigBuilder" in core).toBe(false);
    expect("PluginRegistry" in core).toBe(false);
    expect("ScopedHooksTracker" in core).toBe(false);
    expect("ServiceContainer" in core).toBe(false);
    expect("EngineEntities" in core).toBe(false);
    expect("WasmModuleRunner" in core).toBe(false);
  });

  it("drops GwenEngine.wasmBridge and EngineFramePhaseMs.physics", () => {
    const types = readFileSync(
      path.join(REPO_ROOT, "packages/core/src/engine/engine-types.ts"),
      "utf8",
    );
    expect(types).not.toMatch(/readonly wasmBridge:/);
    expect(types).not.toMatch(/\n  physics: number;/);
  });

  it("drops detectSharedMemoryRequired, requireSAB, wasm.sharedMemory, ContactRingBuffer, and ContactRingBuffer3D from the public surface", () => {
    const forbidden = [
      "detectSharedMemoryRequired",
      "requireSAB",
      "ContactRingBuffer3D",
      "ContactRingBuffer",
      "CONTACT_EVENT_FLOATS",
      "CONTACT_EVENT_BYTES",
      "RING_CAPACITY_3D",
      "RING_CAPACITY",
    ];
    const snaps = [
      "packages/core/public-api.snap.json",
      "packages/physics2d/public-api.snap.json",
      "packages/physics3d/public-api.snap.json",
    ];
    for (const rel of snaps) {
      const text = readFileSync(path.join(REPO_ROOT, rel), "utf8");
      for (const name of forbidden) {
        expect(text, `${rel} ${name}`).not.toContain(`"${name}"`);
      }
    }
    const options = readFileSync(
      path.join(REPO_ROOT, "packages/core/src/engine/wasm-bridge-types.ts"),
      "utf8",
    );
    expect(options).not.toContain("requireSAB");
    const variant = readFileSync(
      path.join(REPO_ROOT, "packages/core/src/utils/variant-detector.ts"),
      "utf8",
    );
    expect(variant).not.toContain("sharedMemory");
    expect(variant).not.toContain("detectSharedMemoryRequired");
  });
});
