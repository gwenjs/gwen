/**
 * @module perf-gate.test
 *
 * CI-blocking performance gate tests for the @gwenjs/core ECS.
 *
 * These tests measure engine ECS operations and fail CI if they regress
 * beyond generous, machine-independent thresholds. They run via
 * `vitest run --dir bench`, not the default unit suite.
 *
 * Thresholds stay at 50ms, 50ms, and 100ms.
 * The chunk-loop gate uses the same 100ms ceiling as the 10 000 each() loop.
 */

import { expect, test } from "vitest";
import { createEngine } from "../src/index";
import { defineComponent, Types } from "../src/schema";
import { defineSystem, onUpdate, useQuery } from "../src/system/runtime/define-system";
import type { EntityId } from "../src/types/entity";

const Position = defineComponent({ name: "Position", schema: { x: Types.f32, y: Types.f32 } });
const Velocity = defineComponent({ name: "Velocity", schema: { vx: Types.f32, vy: Types.f32 } });

test("createEntity() × 1000 completes in < 50ms", async () => {
  const engine = await createEngine({ maxEntities: 1_000 });
  try {
    const start = performance.now();
    for (let i = 0; i < 1_000; i++) {
      engine.createEntity();
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  } finally {
    await engine.stop();
  }
});

test("getComponent() × 1000 completes in < 50ms", async () => {
  const engine = await createEngine({ maxEntities: 1_000 });
  try {
    const ids: EntityId[] = [];
    for (let i = 0; i < 1_000; i++) {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: i, y: 0 });
      ids.push(id);
    }

    const start = performance.now();
    for (let i = 0; i < 1_000; i++) {
      engine.getComponent(ids[i]!, Position);
    }
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(50);
  } finally {
    await engine.stop();
  }
});

test("QueryEngine.resolve iteration over 10 000 entities completes in < 100ms", async () => {
  const engine = await createEngine({ maxEntities: 10_000 });
  try {
    for (let i = 0; i < 10_000; i++) {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: i, y: 0 });
      engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
    }
    const query = engine.createLiveQuery([Position, Velocity]);

    const start = performance.now();
    let sum = 0;
    for (const entity of query) {
      sum += entity.get(Position).x;
    }
    const elapsed = performance.now() - start;

    expect(sum).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(100);
  } finally {
    await engine.stop();
  }
});

test("chunk query over 10 000 entities completes in < 100ms", async () => {
  const engine = await createEngine({ maxEntities: 10_000 });
  try {
    for (let i = 0; i < 10_000; i++) {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: i, y: 0 });
      engine.addComponent(id, Velocity, { vx: 1, vy: 0 });
    }

    let rows = 0;
    let sum = 0;
    let elapsed = 0;
    const system = defineSystem("perf-chunk-query", () => {
      const query = useQuery([Position, Velocity]);
      onUpdate((dt) => {
        const start = performance.now();
        for (const chunk of query) {
          const pos = chunk.get(Position);
          const vel = chunk.get(Velocity);
          for (let row = 0; row < chunk.count; row++) {
            const x = pos.x[row] ?? 0;
            const vx = vel.vx[row] ?? 0;
            const next = x + vx * dt;
            pos.x[row] = next;
            sum += next;
            rows += 1;
          }
        }
        elapsed = performance.now() - start;
      });
    });
    await engine.use(system());
    await engine.advance(1 / 60);

    expect(rows).toBe(10_000);
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(elapsed).toBeLessThan(100);
  } finally {
    await engine.stop();
  }
});
