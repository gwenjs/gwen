import { describe, expect, it } from "vitest";

import { type EntityId } from "../../src/index.js";
import { entityIndex } from "../../src/internal.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const STEPS = 600;
const ENTITY_COUNT = 8;
const DT = 1 / 60;

type Handle = RealEngineHandle;

function inputAt(step: number): number {
  return ((step * 13) % 50) / 50;
}

function transformBytes(
  engine: Handle["engine"],
  bridge: Handle["bridge"],
  ids: readonly EntityId[],
): Uint8Array {
  const wasm = bridge.engine();
  wasm.update_transforms();
  const alive = ids
    .filter((id) => engine.isAlive(id))
    .slice()
    .sort((left, right) => entityIndex(left) - entityIndex(right));
  const bytes = new Uint8Array(alive.length * 12);
  const view = new DataView(bytes.buffer);
  alive.forEach((id, row) => {
    const index = entityIndex(id);
    const offset = row * 12;
    view.setFloat32(offset, wasm.get_entity_world_x(index), true);
    view.setFloat32(offset + 4, wasm.get_entity_world_y(index), true);
    view.setFloat32(offset + 8, wasm.get_entity_world_rotation(index), true);
  });
  return bytes;
}

describe("netcode-ready fixed tick", () => {
  it("runs two physics2d engines for 600 steps and keeps the survivor advancing", async () => {
    expect(typeof window).toBe("undefined");
    expect(typeof document).toBe("undefined");

    const first = await createRealEngine({
      variant: "physics2d",
      maxEntities: 32,
      physicsHz: 60,
    });
    let second: Handle | undefined;
    const unsubscribers: Array<() => void> = [];
    const unsubscribed = new Set<() => void>();
    const unsubscribeOnce = (unsubscribe: () => void): void => {
      if (unsubscribed.has(unsubscribe)) return;
      unsubscribe();
      unsubscribed.add(unsubscribe);
    };

    const boot = (handle: Handle): { ids: EntityId[]; unsubscribe: () => void } => {
      const wasm = handle.bridge.engine();
      const ids: EntityId[] = [];
      for (let i = 0; i < ENTITY_COUNT; i += 1) {
        const id = handle.engine.createEntity();
        ids.push(id);
        wasm.add_entity_transform(entityIndex(id), 0, i, 0, 1, 1);
      }
      const unsubscribe = handle.engine.hooks.hook("engine:tick", () => {
        const sample = inputAt(handle.engine.frameCount);
        for (const id of ids) {
          wasm.set_entity_local_position(entityIndex(id), sample, entityIndex(id));
        }
      });
      unsubscribers.push(unsubscribe);
      return { ids, unsubscribe };
    };

    try {
      second = await createRealEngine({
        variant: "physics2d",
        maxEntities: 32,
        physicsHz: 60,
      });
      const roomA = boot(first);
      const roomB = boot(second);

      await first.advance(STEPS, DT);
      await second.advance(STEPS, DT);

      expect(first.engine.frameCount).toBe(STEPS);
      expect(second.engine.frameCount).toBe(STEPS);
      expect(first.engine.physicsHz).toBe(60);
      expect(transformBytes(first.engine, first.bridge, roomA.ids)).toEqual(
        transformBytes(second.engine, second.bridge, roomB.ids),
      );

      await first.dispose();
      unsubscribeOnce(roomA.unsubscribe);
      await second.advance(1, DT);
      expect(second.engine.frameCount).toBe(STEPS + 1);
    } finally {
      for (const unsubscribe of unsubscribers) unsubscribeOnce(unsubscribe);
      await first.dispose();
      await second?.dispose();
    }
  }, 60_000);
});
