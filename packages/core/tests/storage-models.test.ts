import { describe, expect, it } from "vitest";
import {
  DT,
  ModelA,
  ModelB,
  ModelC,
  REFERENCE_FRAMES,
  STORAGE_REFERENCE_SCENE,
  TodayModel,
  runFrame,
  type StorageModel,
} from "../bench/storage-models/models";

function bits(value: number): number {
  const floats = new Float32Array(1);
  const words = new Uint32Array(floats.buffer);
  floats[0] = value;
  return words[0] ?? 0;
}

function assertSame(left: StorageModel, right: StorageModel, entity: number): void {
  const leftPos = left.position(entity);
  const rightPos = right.position(entity);
  expect(bits(leftPos[0]), `position.x ${entity}`).toBe(bits(rightPos[0]));
  expect(bits(leftPos[1]), `position.y ${entity}`).toBe(bits(rightPos[1]));
  const leftVel = left.velocity(entity);
  const rightVel = right.velocity(entity);
  expect(bits(leftVel[0]), `velocity.vx ${entity}`).toBe(bits(rightVel[0]));
  expect(bits(leftVel[1]), `velocity.vy ${entity}`).toBe(bits(rightVel[1]));
  const leftHealth = left.health(entity);
  const rightHealth = right.health(entity);
  expect(leftHealth === undefined, `health presence ${entity}`).toBe(rightHealth === undefined);
  if (leftHealth && rightHealth) {
    expect(bits(leftHealth[0]), `health.current ${entity}`).toBe(bits(rightHealth[0]));
    expect(bits(leftHealth[1]), `health.max ${entity}`).toBe(bits(rightHealth[1]));
  }
  expect(left.hasEnemy(entity), `enemy ${entity}`).toBe(right.hasEnemy(entity));
}

describe("storage model equivalence", () => {
  for (const count of STORAGE_REFERENCE_SCENE) {
    it(`A, B and C match after 60 frames at E=${count}`, () => {
      const packed = new ModelA(count);
      const sparse = new ModelB(count);
      const chunked = new ModelC(count);
      expect(packed.heapBytes()).toBeGreaterThan(0);
      expect(sparse.heapBytes()).toBeGreaterThan(0);
      expect(chunked.heapBytes()).toBeGreaterThan(0);
      for (let frame = 0; frame < REFERENCE_FRAMES; frame++) {
        runFrame(packed, frame, DT);
        runFrame(sparse, frame, DT);
        runFrame(chunked, frame, DT);
      }
      for (let entity = 0; entity < count; entity++) {
        assertSame(packed, sparse, entity);
        assertSame(packed, chunked, entity);
      }
    });
  }

  it("runs the reference scene on a real engine and stops it", async () => {
    const today = await TodayModel.build(1_000);
    try {
      const before = today.position(1);
      for (let frame = 0; frame < REFERENCE_FRAMES; frame++) runFrame(today, frame, 1 / 60);
      expect(today.position(1)[0]).not.toBe(before[0]);
      expect(today.heapBytes()).toBeGreaterThan(0);
    } finally {
      await today.stop();
    }
  });
});
