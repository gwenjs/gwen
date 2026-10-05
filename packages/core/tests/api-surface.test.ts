import { describe, it, expect } from "vitest";
import * as core from "../src/index";
import * as internal from "../src/internal";
import * as system from "../src/system/index";
import * as scene from "../src/scene/index";
import * as actor from "../src/actor/index";

describe("API surface (RFC-V2-013)", () => {
  it("exports stable V2 runtime entrypoints", () => {
    expect(typeof core.createEngine).toBe("function");
    expect(typeof core.setupGwen).toBe("function");
    expect(typeof core.emit).toBe("function");
    expect(typeof system.defineSystem).toBe("function");
    expect(typeof scene.defineScene).toBe("function");
    expect(typeof actor.definePrefab).toBe("function");
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
    expect(typeof internal.detectSharedMemoryRequired).toBe("function");
    expect(typeof internal.engineContext).toBe("object");
    expect(typeof internal.executeAsync).toBe("function");
    expect(typeof internal._getActorEntityId).toBe("function");
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
  });
});
