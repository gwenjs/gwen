import { describe, expect, it } from "vitest";

import { computeSchemaLayout, type SchemaLayout } from "../../src/schema.js";
import { defineComponent, Types, type EntityId } from "../../src/index.js";
import { entityIndex } from "../../src/internal.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";
import type { CoreVariant } from "../../src/engine/wasm-bridge-types.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";

const STEPS = 300;
const ENTITY_COUNT = 64;
const MAX_ENTITIES = 128;
const DT = 1 / 60;

const ScalarF32 = defineComponent({
  name: "detF32",
  schema: { value: Types.f32 },
});

const ScalarU32 = defineComponent({
  name: "detU32",
  schema: { value: Types.u32 },
});

const Vec2 = defineComponent({
  name: "detVec2",
  schema: { value: Types.vec2 },
});

const F32_LAYOUT = computeSchemaLayout(ScalarF32.schema);
const U32_LAYOUT = computeSchemaLayout(ScalarU32.schema);
const VEC2_LAYOUT = computeSchemaLayout(Vec2.schema);

type Engine = RealEngineHandle["engine"];

function buildInputs(): number[] {
  return Array.from({ length: STEPS }, (_, step) => ((step * 17) % 97) / 97);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let length = 0;
  for (const part of parts) length += part.length;
  const out = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function writeLayout(
  parts: Uint8Array[],
  layout: Readonly<SchemaLayout<Record<string, number | Record<string, number>>>>,
  data: Record<string, number | Record<string, number>>,
): void {
  const buffer = new ArrayBuffer(layout.byteLength);
  layout.serialize(data, new DataView(buffer));
  parts.push(new Uint8Array(buffer));
}

function writeF32(parts: Uint8Array[], values: readonly number[]): void {
  const buffer = new ArrayBuffer(values.length * 4);
  const view = new DataView(buffer);
  for (let i = 0; i < values.length; i += 1) {
    view.setFloat32(i * 4, values[i] ?? 0, true);
  }
  parts.push(new Uint8Array(buffer));
}

function writeId(parts: Uint8Array[], id: EntityId): void {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setBigUint64(0, id, true);
  parts.push(new Uint8Array(buffer));
}

function requireComponent<T>(value: T | undefined, name: string, id: EntityId): T {
  if (value === undefined) {
    throw new Error(`missing ${name} on entity ${entityIndex(id)}`);
  }
  return value;
}

function captureWorldBytes(
  engine: Engine,
  bridge: RealEngineHandle["bridge"],
  ids: readonly EntityId[],
  physics: ((id: EntityId) => readonly number[]) | null,
): Uint8Array {
  const wasm = bridge.engine();
  wasm.update_transforms();
  const alive = ids
    .filter((id) => engine.isAlive(id))
    .slice()
    .sort((left, right) => entityIndex(left) - entityIndex(right));
  const parts: Uint8Array[] = [];
  for (const id of alive) {
    writeId(parts, id);
    writeLayout(
      parts,
      F32_LAYOUT as Readonly<SchemaLayout<Record<string, number>>>,
      requireComponent(engine.getComponent(id, ScalarF32), "detF32", id),
    );
    writeLayout(
      parts,
      U32_LAYOUT as Readonly<SchemaLayout<Record<string, number>>>,
      requireComponent(engine.getComponent(id, ScalarU32), "detU32", id),
    );
    writeLayout(
      parts,
      VEC2_LAYOUT as Readonly<SchemaLayout<Record<string, Record<string, number>>>>,
      requireComponent(engine.getComponent(id, Vec2), "detVec2", id),
    );
    const index = entityIndex(id);
    writeF32(parts, [
      wasm.get_entity_world_x(index),
      wasm.get_entity_world_y(index),
      wasm.get_entity_world_rotation(index),
    ]);
    if (physics !== null) writeF32(parts, physics(id));
  }
  return concatBytes(parts);
}

function firstDifferingOffset(left: Uint8Array, right: Uint8Array): number {
  const length = Math.min(left.length, right.length);
  for (let offset = 0; offset < length; offset += 1) {
    if (left[offset] !== right[offset]) return offset;
  }
  return left.length === right.length ? -1 : length;
}

async function runWorld(variant: CoreVariant, inputs: readonly number[]): Promise<Uint8Array> {
  const { engine, bridge, advance } = await createRealEngine({
    variant,
    maxEntities: MAX_ENTITIES,
    physicsHz: 60,
  });
  let unsubscribe = (): void => {};
  const dispose = async (): Promise<void> => {
    unsubscribe();
    await engine.stop();
  };
  try {
    let physics: ((id: EntityId) => readonly number[]) | null = null;
    if (variant === "physics2d") {
      await engine.use(Physics2DPlugin({ gravity: -10, maxEntities: MAX_ENTITIES }));
      const api = engine.inject("physics2d");
      physics = (id) => {
        const position = api.getPosition(id);
        if (position === null) throw new Error(`missing physics2d position ${entityIndex(id)}`);
        return [position.x, position.y];
      };
    } else if (variant === "physics3d") {
      await engine.use(
        Physics3DPlugin({ gravity: { x: 0, y: -10, z: 0 }, maxEntities: MAX_ENTITIES }),
      );
      const api = engine.inject("physics3d");
      physics = (id) => {
        const state = api.getBodyState(id);
        if (state === undefined) throw new Error(`missing physics3d state ${entityIndex(id)}`);
        return [state.position.x, state.position.y, state.position.z];
      };
    }

    const wasm = bridge.engine();
    const ids: EntityId[] = [];
    for (let i = 0; i < ENTITY_COUNT; i += 1) {
      const id = engine.createEntity();
      ids.push(id);
      const column = i % 8;
      const row = Math.floor(i / 8);
      engine.addComponent(id, ScalarF32, { value: 0 });
      engine.addComponent(id, ScalarU32, { value: 0 });
      engine.addComponent(id, Vec2, { value: { x: 0, y: 0 } });
      wasm.add_entity_transform(entityIndex(id), column * 0.5, row * 0.5, 0, 1, 1);
      if (variant === "physics2d") {
        const api = engine.inject("physics2d");
        const handle = api.addRigidBody(id, "dynamic", column * 0.5, row * 0.5 + 1);
        api.addBoxCollider(handle, 0.3, 0.3);
      } else if (variant === "physics3d") {
        engine.inject("physics3d").createBody(id, {
          kind: "dynamic",
          initialPosition: { x: column * 0.5, y: row * 0.5 + 1, z: 0 },
          colliders: [
            { shape: { type: "box", halfX: 0.3, halfY: 0.3, halfZ: 0.3 }, colliderId: i },
          ],
        });
      }
    }

    const probe = ids[0];
    const startY = physics !== null && probe !== undefined ? physics(probe)[1] : undefined;

    let step = 0;
    unsubscribe = engine.hooks.hook("engine:update", () => {
      const sample = inputs[step] ?? 0;
      step += 1;
      for (const id of ids) {
        const scalar = requireComponent(engine.getComponent(id, ScalarF32), "detF32", id);
        const counter = requireComponent(engine.getComponent(id, ScalarU32), "detU32", id);
        const vec = requireComponent(engine.getComponent(id, Vec2), "detVec2", id);
        const next = scalar.value + sample;
        engine.addComponent(id, ScalarF32, { value: next });
        engine.addComponent(id, ScalarU32, {
          value: (counter.value + (sample > 0.5 ? 1 : 0)) >>> 0,
        });
        engine.addComponent(id, Vec2, {
          value: { x: vec.value.x + sample, y: vec.value.y + sample * 0.5 },
        });
        wasm.set_entity_local_position(entityIndex(id), next * 0.01, 0);
      }
    });

    await advance(STEPS, DT);
    expect(step).toBe(STEPS);
    // `physicsHz` is stored but `advance(dt)` ignores it until #79. This is the variable-dt path at dt = 1/60.
    expect(engine.physicsHz).toBe(60);
    if (startY !== undefined && probe !== undefined && physics !== null) {
      const endY = physics(probe)[1];
      expect(endY, `${variant} physics body did not move`).not.toBe(startY);
    }
    return captureWorldBytes(engine, bridge, ids, physics);
  } finally {
    await dispose();
  }
}

describe("fixed-step reproducibility", () => {
  for (const variant of ["light", "physics2d", "physics3d"] as const) {
    it(`${variant}: two fresh engines match for 300 steps`, async () => {
      const inputs = buildInputs();
      const left = await runWorld(variant, inputs);
      const right = await runWorld(variant, inputs);
      const offset = firstDifferingOffset(left, right);
      expect(offset, `first differing offset ${offset}`).toBe(-1);
      expect(left.length).toBeGreaterThan(0);
    }, 120_000);

    it(`${variant}: one changed input at step 150 differs`, async () => {
      const inputs = buildInputs();
      const changed = buildInputs();
      const previous = changed[150] ?? 0;
      changed[150] = previous + 1;
      const left = await runWorld(variant, inputs);
      const right = await runWorld(variant, changed);
      const offset = firstDifferingOffset(left, right);
      expect(offset, "negative control stayed byte-equal").toBeGreaterThanOrEqual(0);
    }, 120_000);
  }
});
