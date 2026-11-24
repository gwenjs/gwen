import { describe, it, expect, afterEach } from "vitest";
import { createLogger, type GwenEngine } from "@gwenjs/core";
import type { Physics3DAPI } from "../src/index";
import type { GwenLogEntry } from "@gwenjs/schema";
import { engineContext } from "@gwenjs/core/internal";
import Physics3DPlugin, { Physics3DPlugin as NamedPhysics3DPlugin } from "../src/index";

afterEach(() => {
  engineContext.unset();
});

describe("Physics3DPlugin foundation", () => {
  it("exports default and named plugin class", () => {
    expect(Physics3DPlugin).toBeDefined();
    expect(NamedPhysics3DPlugin).toBeDefined();
  });

  it("instantiates with expected plugin name", () => {
    const plugin = new Physics3DPlugin();
    expect(plugin.name).toBe("@gwenjs/physics3d");
  });

  it("teardown outside an engine does not throw", async () => {
    const stepped: number[] = [];
    const services = new Map<string, unknown>();
    const hookMap = new Map<string, (...args: unknown[]) => unknown>();
    const bridge = {
      variant: "physics3d" as const,
      getPhysicsBridge() {
        return {
          physics3d_init() {},
          physics3d_step(delta: number) {
            stepped.push(delta);
          },
        };
      },
    };
    const engine = {
      logger: createLogger("test"),
      provide(name: string, value: unknown) {
        services.set(name, value);
      },
      hooks: {
        hook(name: string, callback: (...args: unknown[]) => unknown) {
          hookMap.set(name, callback);
          return () => {};
        },
      },
      tryInject(name: string) {
        if (name === "wasm:bridge") return bridge;
        return undefined;
      },
      isAlive: () => true,
      disposables: { add() {} },
    } as GwenEngine;
    engineContext.set(engine, true);
    try {
      const plugin = Physics3DPlugin({ gravity: { x: 0, y: 0, z: 0 } });
      await plugin.setup(engine);
      const service = services.get("physics3d");
      if (!isPhysicsService(service)) throw new Error("physics3d service missing");
      service.createBody(1n, {
        kind: "kinematic",
        initialPosition: { x: 0, y: 0, z: 0 },
        initialLinearVelocity: { x: 10, y: 0, z: 0 },
      });
      // No current engine: teardown returns (`packages/physics-core/src/plugin.ts:169`).
      engineContext.unset();
      let code = "";
      try {
        plugin.teardown?.();
        code = "none";
      } catch (error: unknown) {
        if (typeof error === "object" && error !== null && "code" in error) {
          const value = error.code;
          code = typeof value === "string" ? value : "thrown";
        } else {
          code = "thrown";
        }
      }
      expect(code).toBe("none");
      engineContext.set(engine, true);
      expect(service.isReady()).toBe(true);
      const before = hookMap.get("engine:before-update");
      if (before === undefined) throw new Error("engine:before-update missing");
      before(1 / 60);
      expect(stepped).toEqual([1 / 60]);
      expect(service.getBodyState(1n)?.position.x).toBeCloseTo(10 / 60, 6);
    } finally {
      engineContext.unset();
    }
  });

  it("warns when the speed cap setter returns 0", async () => {
    const warnings: string[] = [];
    const seen: number[] = [];
    const logger = createLogger("test", {
      providers: [
        {
          handle(entry: GwenLogEntry) {
            warnings.push(entry.message);
          },
        },
      ],
    });
    const bridge = {
      variant: "physics3d" as const,
      getPhysicsBridge() {
        return {
          physics3d_init() {},
          physics3d_set_max_linear_velocity(value: number) {
            seen.push(value);
            return 0;
          },
        };
      },
    };
    const engine = {
      logger,
      provide() {},
      hooks: { hook: () => () => {} },
      tryInject(name: string) {
        if (name === "wasm:bridge") return bridge;
        return undefined;
      },
      isAlive: () => true,
      disposables: { add() {} },
    } as GwenEngine;
    engineContext.set(engine, true);
    const plugin = Physics3DPlugin({ maxLinearVelocity: 50 });
    await plugin.setup(engine);
    expect(seen).toEqual([50]);
    expect(warnings).toContain("[Physics3D] maxLinearVelocity was refused; the previous cap stays");
  });
});

function isPhysicsService(value: unknown): value is Physics3DAPI {
  if (typeof value !== "object" || value === null) return false;
  if (!("isReady" in value) || typeof value.isReady !== "function") return false;
  if (!("createBody" in value) || typeof value.createBody !== "function") return false;
  if (!("getBodyState" in value) || typeof value.getBodyState !== "function") return false;
  return true;
}
