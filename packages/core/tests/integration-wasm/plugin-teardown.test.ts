import { describe, expect, it } from "vitest";

import { defineComponent, Types, type GwenPlugin } from "../../src/index.js";
import { createRealEngine } from "./harness.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem } from "../../../physics2d/src/systems";

const TeardownPosition = defineComponent({
  name: "teardown-position",
  schema: { x: Types.f32, y: Types.f32 },
});

function watchTeardown(plugin: GwenPlugin, order: string[]): GwenPlugin {
  const original = plugin.teardown;
  plugin.teardown = () => {
    order.push(plugin.name);
    if (original === undefined) return;
    return original();
  };
  return plugin;
}

describe("plugin teardown", () => {
  it("dispose() tears down sync, physics and a listener plugin in reverse order and nothing fires after", async () => {
    const handle = await createRealEngine({
      variant: "physics2d",
      maxEntities: 64,
    });
    const { engine } = handle;
    const target = new EventTarget();
    let events = 0;
    let updates = 0;
    const onProbe = (): void => {
      events += 1;
    };
    const order: string[] = [];
    const listener = watchTeardown(
      {
        name: "ProbeListener",
        setup(host) {
          target.addEventListener("probe", onProbe);
          host.hooks.hook("engine:update", () => {
            updates += 1;
          });
        },
        teardown() {
          target.removeEventListener("probe", onProbe);
        },
      },
      order,
    );
    const physicsPlugin = watchTeardown(Physics2DPlugin(), order);
    const sync = watchTeardown(
      createPhysicsKinematicSyncSystem({ positionComponent: TeardownPosition }),
      order,
    );
    const installed: string[] = [];
    try {
      await engine.use(listener);
      installed.push(listener.name);
      await engine.use(physicsPlugin);
      installed.push(physicsPlugin.name);
      await engine.use(sync);
      installed.push(sync.name);
      await expect(engine.unuse(physicsPlugin.name)).rejects.toMatchObject({
        code: "CORE:PLUGIN_IN_USE",
        dependents: [sync.name],
      });
      expect(order).toEqual([]);
    } finally {
      await handle.dispose();
    }
    expect(order).toEqual([...installed].reverse());
    target.dispatchEvent(new Event("probe"));
    await engine.hooks.callHook("engine:update", 0);
    expect(events).toBe(0);
    expect(updates).toBe(0);
    expect(engine.tryInject("physics2d")).toBeUndefined();
  });
});
