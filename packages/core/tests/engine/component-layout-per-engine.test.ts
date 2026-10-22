/**
 * Layout and the 128-name budget belong to each engine.
 * `defineComponent` records neither.
 */
import { afterEach, describe, expect, it } from "vitest";

import { GwenError } from "@gwenjs/schema";

import { CoreErrorCodes, GwenWasmError } from "../../src/engine/engine-errors.js";
import { defineComponent, Types, type ComponentDefinition } from "../../src/schema.js";
import { createRealEngine, type RealEngineHandle } from "../../src/testing/create-real-engine.js";
import type { EntityId } from "../../src/types/entity.js";

const PoseSchema = { x: Types.f32, y: Types.f32 };
const PoseWideSchema = { x: Types.f32, z: Types.f32, w: Types.f32 };

type PoseDef = ComponentDefinition<typeof PoseSchema>;
type PoseWideDef = ComponentDefinition<typeof PoseWideSchema>;
type ScalarDef = ComponentDefinition<{ v: typeof Types.f32 }>;

describe("component layouts per engine", () => {
  const handles: RealEngineHandle[] = [];

  afterEach(async () => {
    const pending = handles.splice(0);
    for (const handle of pending) await handle.dispose();
  });

  it("two engines use one name with two layouts and read their own fields", async () => {
    const handleA = await createRealEngine({ variant: "light", maxEntities: 8 });
    handles.push(handleA);
    const handleB = await createRealEngine({ variant: "light", maxEntities: 8 });
    handles.push(handleB);
    const first: PoseDef = defineComponent({ name: "PerEnginePose", schema: PoseSchema });
    let captured: unknown;
    let second: PoseWideDef | undefined;
    try {
      second = defineComponent({ name: "PerEnginePose", schema: PoseWideSchema });
      captured = second;
    } catch (error: unknown) {
      captured = error;
    }

    expect(captured).not.toBeInstanceOf(GwenError);
    if (second === undefined) {
      throw new Error("expected a component definition");
    }

    const engineA = handleA.engine;
    const engineB = handleB.engine;
    const entityA = engineA.createEntity();
    const entityB = engineB.createEntity();
    engineA.addComponent(entityA, first, { x: 1, y: 2 });
    engineB.addComponent(entityB, second, { x: 3, z: 4, w: 5 });

    expect(engineA.getComponent(entityA, first)?.x).toBe(1);
    expect(engineA.getComponent(entityA, first)?.y).toBe(2);
    expect(engineB.getComponent(entityB, second)?.x).toBe(3);
    expect(engineB.getComponent(entityB, second)?.z).toBe(4);
    expect(engineB.getComponent(entityB, second)?.w).toBe(5);
  });

  it("a changed layout in the same engine is refused with COMPONENT_LAYOUT_INVALID", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    handles.push(handle);
    const engine = handle.engine;
    const first: PoseDef = defineComponent({ name: "PerEngineMismatch", schema: PoseSchema });
    const entity = engine.createEntity();
    engine.addComponent(entity, first, { x: 1, y: 2 });

    let captured: unknown;
    let second: PoseWideDef | undefined;
    try {
      second = defineComponent({ name: "PerEngineMismatch", schema: PoseWideSchema });
      captured = second;
    } catch (error: unknown) {
      captured = error;
    }
    expect(captured).not.toBeInstanceOf(GwenError);
    if (second === undefined) {
      throw new Error("expected a component definition");
    }

    let caught: unknown;
    try {
      engine.addComponent(engine.createEntity(), second, { x: 9, z: 8, w: 7 });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_LAYOUT_INVALID);
    expect(caught.message).toBe("Component layout invalid: PerEngineMismatch");
    expect(engine.getComponent(entity, first)?.x).toBe(1);
    expect(engine.getComponent(entity, first)?.y).toBe(2);
    expect(engine.registeredComponentTypes().size).toBe(1);
  });

  it("the 129th type in one engine is refused at first use with COMPONENT_TYPE_LIMIT_REACHED", async () => {
    const defs: ScalarDef[] = [];
    let defined = 0;
    for (let i = 1; i <= 129; i += 1) {
      try {
        defs.push(defineComponent({ name: `PerEngineLimit${i}`, schema: { v: Types.f32 } }));
        defined += 1;
      } catch {
        break;
      }
    }
    expect(defined).toBe(129);

    const handle = await createRealEngine({ variant: "light", maxEntities: 160 });
    handles.push(handle);
    const engine = handle.engine;
    const entities: EntityId[] = [];
    for (let i = 0; i < 128; i += 1) {
      const def = defs[i];
      if (def === undefined) {
        throw new Error("expected 128 definitions");
      }
      const id = engine.createEntity();
      engine.addComponent(id, def, { v: i + 1 });
      entities.push(id);
    }
    const firstId = entities[0];
    const lastId = entities[127];
    const firstDef = defs[0];
    const lastDef = defs[127];
    const def129 = defs[128];
    if (
      firstId === undefined ||
      lastId === undefined ||
      firstDef === undefined ||
      lastDef === undefined ||
      def129 === undefined
    ) {
      throw new Error("expected 129 definitions");
    }
    expect(engine.registeredComponentTypes().size).toBe(128);
    expect(engine.getComponent(firstId, firstDef)?.v).toBe(1);
    expect(engine.getComponent(lastId, lastDef)?.v).toBe(128);

    let caught: unknown;
    try {
      engine.addComponent(engine.createEntity(), def129, { v: 129 });
    } catch (error: unknown) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(GwenError);
    expect(caught).not.toBeInstanceOf(GwenWasmError);
    if (!(caught instanceof GwenError)) {
      throw new Error("expected GwenError");
    }
    expect(caught.code).toBe(CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED);
    expect(caught.message).toContain("128");
    expect(engine.registeredComponentTypes().size).toBe(128);
    expect(engine.registeredComponentTypes().get("PerEngineLimit129")).toBeUndefined();
  });
});
