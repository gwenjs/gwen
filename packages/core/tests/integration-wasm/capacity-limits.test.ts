import { describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import * as EngineErrors from "../../src/engine/engine-errors.js";
import { CoreErrorCodes, GwenWasmError } from "../../src/engine/engine-errors.js";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { componentRegistryFor } from "../../src/engine/engine-component-registry.js";
import { defineComponent, Types } from "../../src/schema.js";
import { useQuery } from "../../src/system/runtime/define-system.js";
import { createRealEngine } from "./harness.js";

function gwenComponentLimitError(): unknown {
  return Reflect.get(EngineErrors, "GwenComponentLimitError");
}

function isErrorClass(value: unknown): value is new (...args: never[]) => Error {
  return typeof value === "function";
}

function usedTypes(engine: GwenEngine): number {
  return engine.getCapacity().componentTypes.used;
}

describe("capacity limits", () => {
  it("the 129th type throws GwenComponentLimitError naming the component, owner, max and used and the engine stays usable", async () => {
    const kept = defineComponent({ name: "PluginLimit1", schema: { v: Types.f32 } });
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const engine = handle.engine;
      expect(typeof engine.getCapacity).toBe("function");
      const LimitError = gwenComponentLimitError();
      expect(typeof LimitError).toBe("function");
      if (!isErrorClass(LimitError)) return;

      let caught: unknown;
      try {
        await engine.use({
          name: "limit-plugin",
          setup(eng: GwenEngine) {
            for (let i = 1; i <= 129; i += 1) eng.getOrRegisterComponent(`PluginLimit${i}`);
          },
        });
      } catch (error: unknown) {
        caught = error;
      }

      expect(caught).toBeInstanceOf(LimitError);
      expect(caught).toBeInstanceOf(GwenError);
      expect(caught).not.toBeInstanceOf(GwenWasmError);
      expect(caught).toMatchObject({
        name: "GwenComponentLimitError",
        code: CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED,
        component: "PluginLimit129",
        owner: "limit-plugin",
        max: 128,
        used: 128,
      });
      if (!(caught instanceof Error)) return;
      expect(caught.message).toContain(
        'Component "PluginLimit129" (plugin "limit-plugin") cannot register: 128 of 128 component types are in use.',
      );
      expect(engine.getCapacity().componentTypes).toEqual({ used: 128, max: 128 });
      expect(engine.registeredComponentTypes().get("PluginLimit129")).toBeUndefined();

      const entity = engine.createEntity();
      engine.addComponent(entity, kept, { v: 1 });
      expect(engine.getComponent(entity, kept)?.v).toBe(1);
      expect(engine.state).not.toBe("faulted");

      const other = await createRealEngine({ variant: "light", maxEntities: 4 });
      try {
        let runCaught: unknown;
        try {
          other.engine.run(() => {
            for (let i = 1; i <= 129; i += 1) other.engine.getOrRegisterComponent(`RunLimit${i}`);
          });
        } catch (error: unknown) {
          runCaught = error;
        }
        expect(runCaught).toBeInstanceOf(LimitError);
        expect(runCaught).toMatchObject({
          component: "RunLimit129",
          owner: null,
          max: 128,
          used: 128,
        });
        if (!(runCaught instanceof Error)) return;
        expect(runCaught.message).toContain(
          'Component "RunLimit129" cannot register: 128 of 128 component types are in use.',
        );
        expect(other.engine.getCapacity().componentTypes).toEqual({ used: 128, max: 128 });
      } finally {
        await other.dispose();
      }
    } finally {
      await handle.dispose();
    }
  });

  it("maxEntities 100: the 101st spawn fails and the 100 entities stay intact, getCapacity reports 100/100", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 100 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      const ids = [];
      let caught: unknown;
      try {
        for (let n = 0; n < 101; n += 1) ids.push(engine.createEntity());
      } catch (error: unknown) {
        caught = error;
      }

      expect(ids).toHaveLength(100);
      expect(caught).toBeInstanceOf(GwenWasmError);
      expect(caught).toBeInstanceOf(GwenError);
      if (!(caught instanceof GwenError)) return;
      expect(caught.code).toBe(CoreErrorCodes.ENTITY_LIMIT_REACHED);
      for (const id of ids) expect(engine.isAlive(id)).toBe(true);
      expect(engine.getCapacity().entities).toEqual({ alive: 100, max: 100 });
      expect(engine.state).not.toBe("faulted");
    } finally {
      await handle.dispose();
    }
  });

  it("unuse releases the 3 types a plugin registered synchronously in setup, and use again keeps the count", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      const base = usedTypes(engine);

      await engine.use({ name: "empty-slots", setup() {} });
      expect(usedTypes(engine)).toBe(base);
      await engine.unuse("empty-slots");
      expect(usedTypes(engine)).toBe(base);

      const plugin = {
        name: "three-types",
        setup(eng: GwenEngine) {
          eng.getOrRegisterComponent("SlotA");
          eng.getOrRegisterComponent("SlotB");
          eng.getOrRegisterComponent("SlotC");
        },
      };
      await engine.use(plugin);
      expect(usedTypes(engine)).toBe(base + 3);
      await engine.unuse(plugin.name);
      expect(usedTypes(engine)).toBe(base);
      expect(engine.registeredComponentTypes().get("SlotA")).toBeUndefined();
      await engine.use(plugin);
      expect(usedTypes(engine)).toBe(base + 3);
    } finally {
      await handle.dispose();
    }
  });

  it("a type first registered after an await in setup has owner null and is not released by unuse", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      const base = usedTypes(engine);
      await engine.use({
        name: "late-plugin",
        async setup(eng: GwenEngine) {
          eng.getOrRegisterComponent("SyncType");
          await Promise.resolve();
          eng.getOrRegisterComponent("LateType");
        },
      });
      expect(usedTypes(engine)).toBe(base + 2);
      await engine.unuse("late-plugin");
      expect(usedTypes(engine)).toBe(base + 1);
      expect(engine.registeredComponentTypes().get("SyncType")).toBeUndefined();
      expect(engine.registeredComponentTypes().get("LateType")).toEqual(expect.any(Number));
    } finally {
      await handle.dispose();
    }
  });

  it("a type with a live entity is not released: release returns false and its data is intact", async () => {
    const live = defineComponent({ name: "LiveRow", schema: { v: Types.f32 } });
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      const base = usedTypes(engine);
      let entity: ReturnType<GwenEngine["createEntity"]> | undefined;
      await engine.use({
        name: "rows-plugin",
        setup(eng: GwenEngine) {
          eng.getOrRegisterComponent("FreeRow");
          entity = eng.createEntity();
          eng.addComponent(entity, live, { v: 4 });
        },
      });
      expect(usedTypes(engine)).toBe(base + 2);
      await engine.unuse("rows-plugin");
      expect(usedTypes(engine)).toBe(base + 1);
      expect(componentRegistryFor(engine).release("LiveRow")).toBe(false);
      if (entity === undefined) throw new Error("expected an entity");
      expect(engine.getComponent(entity, live)?.v).toBe(4);
      expect(engine.registeredComponentTypes().get("LiveRow")).toEqual(expect.any(Number));
      expect(engine.registeredComponentTypes().get("FreeRow")).toBeUndefined();
    } finally {
      await handle.dispose();
    }
  });

  it("a plugin that queries its own type in setup frees it on unuse", async () => {
    const queried = defineComponent({ name: "QueriedType", schema: { v: Types.f32 } });
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      const base = usedTypes(engine);
      await engine.use({
        name: "query-plugin",
        setup() {
          useQuery([queried]);
        },
      });
      expect(usedTypes(engine)).toBe(base + 1);
      await engine.unuse("query-plugin");
      expect(usedTypes(engine)).toBe(base);
      expect(engine.registeredComponentTypes().get("QueriedType")).toBeUndefined();
    } finally {
      await handle.dispose();
    }
  });

  it("a plugin whose teardown destroys its entity frees the type on unuse", async () => {
    const held = defineComponent({ name: "TornDown", schema: { v: Types.f32 } });
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      const base = usedTypes(engine);
      let entity: ReturnType<GwenEngine["createEntity"]> | undefined;
      await engine.use({
        name: "teardown-plugin",
        setup(eng: GwenEngine) {
          entity = eng.createEntity();
          eng.addComponent(entity, held, { v: 3 });
        },
        teardown() {
          if (entity !== undefined) engine.destroyEntity(entity);
        },
      });
      expect(usedTypes(engine)).toBe(base + 1);
      await engine.unuse("teardown-plugin");
      expect(usedTypes(engine)).toBe(base);
      expect(engine.registeredComponentTypes().get("TornDown")).toBeUndefined();
      if (entity === undefined) throw new Error("expected an entity");
      expect(engine.isAlive(entity)).toBe(false);
    } finally {
      await handle.dispose();
    }
  });

  it("getCapacity reflects a release immediately", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const { engine } = handle;
      expect(typeof engine.getCapacity).toBe("function");
      engine.getOrRegisterComponent("Permanent");
      expect(usedTypes(engine)).toBe(1);
      await engine.use({
        name: "temp-plugin",
        setup(eng: GwenEngine) {
          eng.getOrRegisterComponent("TempType");
        },
      });
      expect(usedTypes(engine)).toBe(2);
      await engine.unuse("temp-plugin");
      expect(engine.getCapacity().componentTypes.used).toBe(1);
      expect(engine.getCapacity().componentTypes.max).toBe(128);
    } finally {
      await handle.dispose();
    }
  });

  it("two engines count their own types", async () => {
    const handleA = await createRealEngine({ variant: "light", maxEntities: 4 });
    try {
      const handleB = await createRealEngine({ variant: "light", maxEntities: 4 });
      try {
        const engineA = handleA.engine;
        const engineB = handleB.engine;
        expect(typeof engineA.getCapacity).toBe("function");
        expect(typeof engineB.getCapacity).toBe("function");
        const usedB = usedTypes(engineB);
        const usedA = usedTypes(engineA);
        engineA.getOrRegisterComponent("OnlyA");
        expect(usedTypes(engineA)).toBe(usedA + 1);
        expect(usedTypes(engineB)).toBe(usedB);
        expect(engineB.registeredComponentTypes().get("OnlyA")).toBeUndefined();
        expect(engineA.getCapacity().componentTypes.max).toBe(128);
        expect(engineB.getCapacity().componentTypes.max).toBe(128);
      } finally {
        await handleB.dispose();
      }
    } finally {
      await handleA.dispose();
    }
  });
});
