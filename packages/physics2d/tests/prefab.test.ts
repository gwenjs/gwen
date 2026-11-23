/**
 * Prefab extension key `physics2d` and pixel velocity.
 */
import { afterEach, describe, expect, it } from "vitest";
import { createEntityId } from "@gwenjs/core";
import { engineContext } from "@gwenjs/core/internal";
import type { EntityId } from "@gwenjs/schema";
import { Physics2DPlugin } from "../src/index.js";

afterEach(() => {
  engineContext.unset();
});

function boot(): {
  trigger: (entityId: EntityId, extensions: object) => Promise<void>;
  bodies: number[][];
  colliders: string[];
} {
  const bodies: number[][] = [];
  const colliders: string[] = [];
  const hooks = new Map<string, Array<(...args: never[]) => void>>();
  const wasm = {
    physics_init() {},
    physics_set_max_linear_velocity() {
      return 1;
    },
    physics_set_quality() {},
    physics_set_event_coalescing() {},
    physics_set_global_ccd_enabled() {},
    physics_add_rigid_body(...args: number[]) {
      bodies.push(args);
      return 42;
    },
    physics_add_box_collider() {
      colliders.push("box");
    },
    physics_add_ball_collider() {
      colliders.push("ball");
    },
  };
  const bridge = {
    hasPhysics: () => true,
    getPhysicsBridge: () => wasm,
    getLinearMemory: () => ({ buffer: new ArrayBuffer(8) }),
  };
  const engine = {
    logger: undefined,
    isAlive: () => true,
    provide() {},
    disposables: { add() {} },
    tryInject(name: string) {
      if (name === "wasm:bridge") return bridge;
      return undefined;
    },
    hooks: {
      hook(name: string, handler: (...args: never[]) => void) {
        const list = hooks.get(name) ?? [];
        list.push(handler);
        hooks.set(name, list);
        return () => {};
      },
    },
  };
  engineContext.set(engine as never, true);
  const plugin = Physics2DPlugin();
  plugin.setup!(engine as never);
  return {
    bodies,
    colliders,
    async trigger(entityId, extensions) {
      for (const handler of hooks.get("prefab:instantiate") ?? []) {
        await handler(entityId as never, extensions as never);
      }
    },
  };
}

const entityId = createEntityId(1, 0);

describe("physics2d prefab extension", () => {
  it("a prefab with extensions.physics2d gets a body and colliders", async () => {
    const { trigger, bodies, colliders } = boot();
    await trigger(entityId, {
      physics2d: { bodyType: "dynamic", colliders: [{ shape: "box", hw: 20, hh: 10 }] },
    });
    expect(bodies).toHaveLength(1);
    expect(colliders).toEqual(["box"]);
  });

  it("the old key extensions.physics creates no body", async () => {
    const { trigger, bodies } = boot();
    await trigger(entityId, {
      physics: { bodyType: "dynamic", colliders: [{ shape: "box", hw: 20, hh: 10 }] },
    });
    expect(bodies).toHaveLength(0);
  });

  it("initialLinearVelocity is converted from pixels to metres", async () => {
    const { trigger, bodies } = boot();
    await trigger(entityId, {
      physics2d: {
        bodyType: "dynamic",
        initialLinearVelocity: { x: 100, y: -200 },
        colliders: [{ shape: "ball", radius: 10 }],
      },
    });
    expect(bodies[0]?.[8]).toBe(2);
    expect(bodies[0]?.[9]).toBe(-4);
  });
});
