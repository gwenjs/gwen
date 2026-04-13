import { describe, it, expect, vi } from "vitest";
import { getOrCreateScreenService } from "../../src/get-or-create-screen-service.js";
import { ScreenServiceImpl } from "../../src/screen-service.js";
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
    hooks: { hook: vi.fn() },
  } as unknown as GwenEngine;
}

describe("getOrCreateScreenService", () => {
  it("returns a ScreenServiceImpl instance", () => {
    const engine = makeEngine();
    const svc = getOrCreateScreenService(engine);
    expect(svc).toBeInstanceOf(ScreenServiceImpl);
  });

  it("provides the service under screenService key", () => {
    const engine = makeEngine();
    getOrCreateScreenService(engine);
    expect(engine.provide).toHaveBeenCalledWith("screenService", expect.any(ScreenServiceImpl));
  });

  it("returns the same instance on subsequent calls (singleton)", () => {
    const engine = makeEngine();
    const first = getOrCreateScreenService(engine);
    const second = getOrCreateScreenService(engine);
    expect(first).toBe(second);
  });
});
