import { describe, expect, it } from "vitest";

import type { EntityId } from "../../src/index.js";
import type { GwenEngine } from "../../src/engine/gwen-engine.js";
import { createRealEngine } from "./harness.js";

export interface Vec {
  x: number;
  y: number;
  z?: number;
}

export interface PhysicsConformanceAdapter {
  variant: "physics2d" | "physics3d";
  install(engine: GwenEngine, gravity: number): Promise<void>;
  installKinematicSync(engine: GwenEngine): Promise<void>;
  createDynamicBody(id: EntityId, at: Vec, collider: boolean): void;
  createKinematicBody(id: EntityId, at: Vec): void;
  moveEcs(id: EntityId, to: Vec): void;
  position(id: EntityId): Vec | null;
  removeBody(id: EntityId): void;
  contactCount(): number;
}

const FRAMES = 10;
const DT = 1 / 60;

export function runPhysicsConformance(adapter: PhysicsConformanceAdapter): void {
  describe(`physics conformance (${adapter.variant})`, () => {
    it("a dynamic body moves toward gravity", async () => {
      const handle = await createRealEngine({
        variant: adapter.variant,
        maxEntities: 64,
      });
      try {
        await adapter.install(handle.engine, -10);
        const id = handle.engine.createEntity();
        adapter.createDynamicBody(id, { x: 0, y: 5, z: 0 }, false);
        const start = adapter.position(id);
        expect(start).not.toBeNull();

        await handle.advance(FRAMES, DT);

        const next = adapter.position(id);
        expect(next).not.toBeNull();
        expect(next!.y).toBeLessThan(start!.y);
      } finally {
        await handle.dispose();
      }
    });

    it("an ECS move reaches a kinematic body", async () => {
      const handle = await createRealEngine({
        variant: adapter.variant,
        maxEntities: 64,
      });
      try {
        await adapter.install(handle.engine, 0);
        await adapter.installKinematicSync(handle.engine);
        const id = handle.engine.createEntity();
        adapter.createKinematicBody(id, { x: 0, y: 0, z: 0 });
        adapter.moveEcs(id, { x: 4, y: 0, z: 0 });

        await handle.advance(FRAMES, DT);

        const position = adapter.position(id);
        expect(position).not.toBeNull();
        expect(position!.x).toBeGreaterThan(1);
      } finally {
        await handle.dispose();
      }
    });

    it("overlapping bodies with colliders produce at least one contact", async () => {
      const handle = await createRealEngine({
        variant: adapter.variant,
        maxEntities: 64,
      });
      try {
        await adapter.install(handle.engine, 0);
        const left = handle.engine.createEntity();
        const right = handle.engine.createEntity();
        adapter.createDynamicBody(left, { x: 0, y: 0, z: 0 }, true);
        adapter.createDynamicBody(right, { x: 0.2, y: 0, z: 0 }, true);

        let seen = 0;
        for (let frame = 0; frame < FRAMES; frame += 1) {
          await handle.advance(1, DT);
          seen = Math.max(seen, adapter.contactCount());
        }
        expect(seen).toBeGreaterThan(0);
      } finally {
        await handle.dispose();
      }
    });

    it("position() is null after removeBody", async () => {
      const handle = await createRealEngine({
        variant: adapter.variant,
        maxEntities: 64,
      });
      try {
        await adapter.install(handle.engine, 0);
        const id = handle.engine.createEntity();
        adapter.createDynamicBody(id, { x: 1, y: 2, z: 0 }, false);
        expect(adapter.position(id)).not.toBeNull();

        adapter.removeBody(id);

        expect(adapter.position(id)).toBeNull();
      } finally {
        await handle.dispose();
      }
    });
  });
}
