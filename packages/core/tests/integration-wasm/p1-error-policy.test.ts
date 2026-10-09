import { describe, expect, it } from "vitest";

import { CoreErrorCodes, type EngineErrorPayload } from "../../src/index.js";
import { defineSystem, onUpdate } from "../../src/system/index.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

// (func (export "trap") unreachable)
function trapModuleBytes(): Uint8Array<ArrayBuffer> {
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00, 0x03, 0x02,
    0x01, 0x00, 0x07, 0x08, 0x01, 0x04, 0x74, 0x72, 0x61, 0x70, 0x00, 0x00, 0x0a, 0x05, 0x01, 0x03,
    0x00, 0x00, 0x0b,
  ]);
}

async function useReal(
  variant: "light" | "physics2d",
  maxEntities: number,
  body: (handle: RealEngineHandle) => Promise<void>,
): Promise<RealEngineHandle> {
  const handle = await createRealEngine({ variant, maxEntities });
  try {
    await body(handle);
  } finally {
    await handle.dispose();
  }
  return handle;
}

describe("P1 error policy (real WASM)", () => {
  it("faults when a system calls an inline trap export", async () => {
    const handle = await useReal("light", 64, async ({ engine }) => {
      const { instance } = await WebAssembly.instantiate(trapModuleBytes());
      const trap = instance.exports["trap"];
      if (typeof trap !== "function") throw new Error("expected trap export");

      const errors: EngineErrorPayload[] = [];
      engine.hooks.hook("engine:error", (payload) => {
        errors.push(payload);
      });
      await engine.use(
        defineSystem("TrapSys", () => {
          onUpdate(() => {
            trap();
          });
        })(),
      );
      await engine.startExternal();
      await engine.advance(1 / 60);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.level).toBe("fatal");
      expect(errors[0]?.code).toBe(CoreErrorCodes.WASM_PANIC);
      expect(errors[0]?.target?.kind).toBe("system");
      expect(engine.state).toBe("faulted");
      await expect(engine.advance(1 / 60)).rejects.toThrow(/faulted/);
    });
    expect(handle.engine.state).toBe("faulted");
  });

  it("isolates a community module trap and keeps other systems running", async () => {
    const handle = await useReal("light", 64, async ({ engine }) => {
      let ticks = 0;
      await engine.use(
        defineSystem("Keeper", () => {
          onUpdate(() => {
            ticks += 1;
          });
        })(),
      );
      const url = `data:application/wasm;base64,${Buffer.from(trapModuleBytes()).toString("base64")}`;
      await engine.loadWasmModule({
        name: "trap-mod",
        url,
        step(handle) {
          const trap = handle.exports["trap"];
          if (typeof trap !== "function") throw new Error("expected trap export");
          trap();
        },
      });
      const errors: EngineErrorPayload[] = [];
      engine.hooks.hook("engine:error", (payload) => {
        errors.push(payload);
      });

      await engine.startExternal();
      await engine.advance(1 / 60);
      await engine.advance(1 / 60);

      expect(errors).toHaveLength(1);
      expect(errors[0]?.level).toBe("error");
      expect(errors[0]?.code).toBe(CoreErrorCodes.WASM_PANIC);
      expect(errors[0]?.target).toMatchObject({ kind: "wasm-module", id: "wasm:trap-mod" });
      expect(engine.isolated().some((target) => target.id === "wasm:trap-mod")).toBe(true);
      expect(ticks).toBe(2);
      expect(engine.state).toBe("running");
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("keeps a physics2d body falling while a sibling system throws", async () => {
    const handle = await useReal("physics2d", 64, async ({ engine, advance }) => {
      await engine.use(Physics2DPlugin({ gravity: -10 }));
      let ticks = 0;
      await engine.use(
        defineSystem("Keeper", () => {
          onUpdate(() => {
            ticks += 1;
          });
        })(),
      );
      await engine.use(
        defineSystem("BadSys", () => {
          onUpdate(() => {
            throw new Error("every frame");
          });
        })(),
      );
      const physics = engine.inject("physics2d");
      const body = engine.createEntity();
      physics.addRigidBody(body, "dynamic", 0, 5);
      const start = physics.getPosition(body);
      if (start === null) throw new Error("expected a physics2d body position");

      await advance(10, 1 / 60);

      const end = physics.getPosition(body);
      if (end === null) throw new Error("expected a physics2d body position");
      expect(end.y).toBeLessThan(start.y);
      expect(ticks).toBe(10);
      expect(
        engine.isolated().some((target) => target.kind === "system" && target.name === "BadSys"),
      ).toBe(true);
      expect(engine.state).toBe("running");
    });
    expect(handle.engine.state).toBe("stopped");
  });

  it("reports a rejected physics:collision hook on the error bus", async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on("unhandledRejection", onUnhandled);
    const handle = await createRealEngine({
      variant: "physics2d",
      maxEntities: 64,
    });
    const { engine, advance } = handle;
    try {
      await engine.use(Physics2DPlugin({ gravity: 0 }));
      const events: EngineErrorPayload[] = [];
      engine.hooks.hook("engine:error", (payload) => {
        events.push(payload);
      });
      engine.hooks.hook("physics:collision", () =>
        Promise.reject(new Error("collision hook failed")),
      );
      const physics = engine.inject("physics2d");
      const left = engine.createEntity();
      const right = engine.createEntity();
      const leftHandle = physics.addRigidBody(left, "dynamic", 0, 0);
      const rightHandle = physics.addRigidBody(right, "dynamic", 0.2, 0);
      physics.addBoxCollider(leftHandle, 0.5, 0.5);
      physics.addBoxCollider(rightHandle, 0.5, 0.5);

      await advance(5, 1 / 60);
      await new Promise<void>((resolve) => {
        setImmediate(resolve);
      });

      expect(unhandled).toEqual([]);
      expect(events.some((event) => event.message === "collision hook failed")).toBe(true);
      expect(events.find((event) => event.message === "collision hook failed")).toMatchObject({
        level: "error",
        code: CoreErrorCodes.PLUGIN_RUNTIME_ERROR,
        source: "@gwenjs/physics2d",
      });
      // A rejected callHook does not say which listener failed: no target, no isolation.
      expect(
        events.find((event) => event.message === "collision hook failed")?.target,
      ).toBeUndefined();
      expect(engine.isolated()).toEqual([]);
    } finally {
      process.off("unhandledRejection", onUnhandled);
      await handle.dispose();
    }
  });
});
