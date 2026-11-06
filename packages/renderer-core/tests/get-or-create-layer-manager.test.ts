// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createManagerServices } from "../src/create-manager-services.js";
import { getOrCreateLayerManager } from "../src/get-or-create-layer-manager.js";
import { LayerManager } from "../src/layer-manager.js";
import type { GwenEngine, GwenLogger } from "@gwenjs/core";

let services = new Map<string, unknown>();

function makeEngine(): GwenEngine {
  services = new Map<string, unknown>();
  const childLogger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  const logger: GwenLogger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue(childLogger),
  };

  return {
    logger,
    provide: vi.fn((key: string, value: unknown) => {
      services.set(key, value);
    }),
    tryInject: vi.fn((key: string) => services.get(key)),
    inject: (key: string) => {
      const value = services.get(key);
      if (value === undefined) throw new Error(`No plugin provides service "${key}".`);
      return value;
    },
    hooks: {
      hook: vi.fn(),
    },
  } as unknown as GwenEngine;
}

function seed(engine: GwenEngine): LayerManager {
  const created = createManagerServices(engine);
  services.set("layerManager", created.layerManager);
  const manager = created.layerManager;
  if (!(manager instanceof LayerManager)) throw new Error("expected LayerManager");
  return manager;
}

describe("getOrCreateLayerManager", () => {
  let engine: GwenEngine;
  let container: HTMLElement;

  beforeEach(() => {
    engine = makeEngine();
    container = document.createElement("div");
    document.body.appendChild(container);
  });

  it("returns the declared LayerManager", () => {
    const seeded = seed(engine);
    const manager = getOrCreateLayerManager(engine, container);
    expect(manager).toBeInstanceOf(LayerManager);
    expect(manager).toBe(seeded);
  });

  it("does not provide a manager of its own", () => {
    seed(engine);
    getOrCreateLayerManager(engine, container);
    expect(engine.provide).not.toHaveBeenCalled();
  });

  it("returns the same instance on subsequent calls (singleton per engine)", () => {
    seed(engine);
    const first = getOrCreateLayerManager(engine, container);
    const second = getOrCreateLayerManager(engine, container);
    expect(first).toBe(second);
  });

  it("does not provide again when called twice", () => {
    seed(engine);
    getOrCreateLayerManager(engine, container);
    getOrCreateLayerManager(engine, container);
    expect(engine.provide).not.toHaveBeenCalled();
  });

  it("uses engine.logger.child() to bind to the engine log hierarchy", () => {
    seed(engine);
    expect(engine.logger.child).toHaveBeenCalledWith("renderer-core");
  });

  it("second call ignores the new container and reuses the existing manager", () => {
    seed(engine);
    const first = getOrCreateLayerManager(engine, container);
    const otherContainer = document.createElement("div");
    const second = getOrCreateLayerManager(engine, otherContainer);
    expect(second).toBe(first);
  });

  it("registers an engine:tick hook for beginFrame() once at creation", () => {
    seed(engine);
    getOrCreateLayerManager(engine, container);
    getOrCreateLayerManager(engine, container);
    // engine:tick is registered once when the manager is created, not on each read
    expect(engine.hooks.hook).toHaveBeenCalledTimes(2);
    expect(engine.hooks.hook).toHaveBeenCalledWith("engine:tick", expect.any(Function));
    expect(engine.hooks.hook).toHaveBeenCalledWith("engine:render", expect.any(Function));
  });
});
