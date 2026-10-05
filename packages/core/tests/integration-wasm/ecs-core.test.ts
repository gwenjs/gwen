import { describe, expect, it } from "vitest";

import { createEntityId } from "../../src/index.js";
import { createRealEngine } from "./harness.js";

const SEED = 0x70ec5;
const STEPS = 64;
const MAX_ENTITIES = 32;
const COMPONENT_BYTES = new Uint8Array([1, 2, 3, 4]);

interface Slot {
  generation: number;
  alive: boolean;
}

interface Model {
  slots: Slot[];
  free: number[];
  live: number;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function canCreate(model: Model): boolean {
  return model.free.length > 0 || model.slots.length < MAX_ENTITIES;
}

describe("real WASM ECS core", () => {
  it("matches a fixed-seed reference model and rejects stale ids", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: MAX_ENTITIES });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponentType();
      const random = mulberry32(SEED);
      const model: Model = { slots: [], free: [], live: 0 };

      for (let step = 0; step < STEPS; step += 1) {
        const roll = random();
        if (roll < 0.4 && canCreate(model)) {
          const created = bridge.createEntity();
          if (model.free.length > 0) {
            const index = model.free.pop()!;
            const slot = model.slots[index]!;
            slot.generation = (slot.generation + 1) >>> 0;
            slot.alive = true;
            expect(created.index).toBe(index);
            expect(created.generation).toBe(slot.generation);
          } else {
            expect(created.index).toBe(model.slots.length);
            expect(created.generation).toBe(0);
            model.slots.push({ generation: 0, alive: true });
          }
          model.live += 1;
        } else if (roll < 0.7 && model.slots.length > 0) {
          const index = Math.floor(random() * model.slots.length);
          const slot = model.slots[index]!;
          const deleted = bridge.deleteEntity(index, slot.generation);
          expect(deleted).toBe(slot.alive);
          if (slot.alive) {
            slot.alive = false;
            model.free.push(index);
            model.live -= 1;
          }
        } else if (model.slots.length > 0) {
          const index = Math.floor(random() * model.slots.length);
          const slot = model.slots[index]!;
          const added = bridge.addComponent(index, slot.generation, typeId, COMPONENT_BYTES);
          expect(added).toBe(slot.alive);
          if (slot.alive && random() < 0.5) {
            expect(bridge.removeComponent(index, slot.generation, typeId)).toBe(true);
          }
        }

        expect(bridge.countEntities()).toBe(model.live);
        for (let index = 0; index < model.slots.length; index += 1) {
          const slot = model.slots[index]!;
          const stale = (slot.generation + 1) >>> 0;
          expect(bridge.isAlive(index, slot.generation)).toBe(slot.alive);
          expect(bridge.isAlive(index, stale)).toBe(false);
          expect(bridge.addComponent(index, stale, typeId, COMPONENT_BYTES)).toBe(false);
        }
      }
    } finally {
      await handle.dispose();
    }
  });

  it("reads added bytes back through the bulk path and ends at count 0", async () => {
    const handle = await createRealEngine({ variant: "light", maxEntities: 8 });
    try {
      const { bridge } = handle;
      const typeId = bridge.registerComponentType();
      const created = bridge.createEntity();
      expect(bridge.addComponent(created.index, created.generation, typeId, COMPONENT_BYTES)).toBe(
        true,
      );

      const read = bridge.readComponentsBulk(
        [createEntityId(created.index, created.generation)],
        typeId,
        COMPONENT_BYTES.byteLength,
      );
      expect(read.byteLength).toBe(COMPONENT_BYTES.byteLength);
      expect(Array.from(new Uint8Array(read.buffer, read.byteOffset, read.byteLength))).toEqual(
        Array.from(COMPONENT_BYTES),
      );

      expect(bridge.deleteEntity(created.index, created.generation)).toBe(true);
      expect(bridge.countEntities()).toBe(0);
    } finally {
      await handle.dispose();
    }
  });
});
