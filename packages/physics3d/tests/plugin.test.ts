import { describe, it, expect, afterEach } from "vitest";
import { createLogger, type GwenEngine } from "@gwenjs/core";
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
