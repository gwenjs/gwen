// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrCreateLayerManager } from "../src/get-or-create-layer-manager.js";
import { LayerManager } from "../src/layer-manager.js";
import type { GwenEngine, GwenLogger } from "@gwenjs/core";

function makeEngine(): GwenEngine {
  const services = new Map<string, unknown>();
  const childLogger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
    setSink: vi.fn(),
  };
  const logger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
    setSink: vi.fn(),
  };

  return {
    logger,
    provide: vi.fn((key: string, value: unknown) => {
      services.set(key, value);
    }),
    tryInject: vi.fn((key: string) => services.get(key)),
  } as unknown as GwenEngine;
}

describe("getOrCreateLayerManager", () => {
  let engine: GwenEngine;
  let container: HTMLElement;

  beforeEach(() => {
    engine = makeEngine();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("returns a LayerManager instance", () => {
    const manager = getOrCreateLayerManager(engine, container);
    expect(manager).toBeInstanceOf(LayerManager);
  });

  it("provides the manager on the engine under 'layerManager'", () => {
    getOrCreateLayerManager(engine, container);
    expect(engine.provide).toHaveBeenCalledWith("layerManager", expect.any(LayerManager));
  });

  it("returns the same instance on subsequent calls (singleton per engine)", () => {
    const first = getOrCreateLayerManager(engine, container);
    const second = getOrCreateLayerManager(engine, container);
    expect(first).toBe(second);
  });

  it("only provides the manager once even when called multiple times", () => {
    getOrCreateLayerManager(engine, container);
    getOrCreateLayerManager(engine, container);
    expect(engine.provide).toHaveBeenCalledOnce();
  });

  it("uses engine.logger.child() to bind to the engine log hierarchy", () => {
    getOrCreateLayerManager(engine, container);
    expect(engine.logger.child).toHaveBeenCalledWith("renderer-core");
  });

  it("second call ignores the new container and reuses the existing manager", () => {
    const first = getOrCreateLayerManager(engine, container);
    const otherContainer = document.createElement("div");
    const second = getOrCreateLayerManager(engine, otherContainer);
    expect(second).toBe(first);
  });
});
