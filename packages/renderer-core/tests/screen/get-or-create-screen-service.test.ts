import { describe, it, expect, vi } from "vitest";
import { getOrCreateScreenService } from "../../src/get-or-create-screen-service.js";
import { ScreenServiceImpl } from "../../src/screen-service.js";
import { ViewportManagerImpl } from "../../src/viewport-manager.js";
import type { GwenEngine, GwenLogger } from "@gwenjs/core";

function makeEngine(): { engine: GwenEngine; services: Map<string, unknown> } {
  const services = new Map<string, unknown>();
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
  const engine = {
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
    hooks: { hook: vi.fn() },
  } as unknown as GwenEngine;
  return { engine, services };
}

function seedScreen(services: Map<string, unknown>, engine: GwenEngine): ScreenServiceImpl {
  const vm = new ViewportManagerImpl(() => {});
  const svc = new ScreenServiceImpl(engine.logger.child("renderer-core:screen"), vm);
  services.set("screenService", svc);
  return svc;
}

describe("getOrCreateScreenService", () => {
  it("returns the declared ScreenServiceImpl", () => {
    const { engine, services } = makeEngine();
    expect(() => getOrCreateScreenService(engine)).toThrow(
      'No plugin provides service "screenService".',
    );
    const seeded = seedScreen(services, engine);
    const svc = getOrCreateScreenService(engine);
    expect(svc).toBe(seeded);
    expect(svc).toBeInstanceOf(ScreenServiceImpl);
  });

  it("does not provide a screenService of its own", () => {
    const { engine, services } = makeEngine();
    expect(() => getOrCreateScreenService(engine)).toThrow(
      'No plugin provides service "screenService".',
    );
    expect(engine.provide).not.toHaveBeenCalled();
    expect(services.has("screenService")).toBe(false);
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    const { engine, services } = makeEngine();
    seedScreen(services, engine);
    const first = getOrCreateScreenService(engine);
    const second = getOrCreateScreenService(engine);
    expect(first).toBe(second);
  });
});
