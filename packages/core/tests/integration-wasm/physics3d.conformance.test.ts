import { defineComponent, Types, type EntityId } from "../../src/index.js";
import type { GwenEngine } from "../../src/engine/gwen-engine.js";
import "../../../physics3d/src/augment";
import { Physics3DPlugin } from "../../../physics3d/src/plugin/index";
import { createPhysicsKinematicSyncSystem } from "../../../physics3d/src/systems";
import type { Physics3DAPI } from "../../../physics3d/src/types";
import { runPhysicsConformance, type Vec } from "./physics-conformance.js";

const Transform3D = defineComponent({
  name: "transform3d",
  schema: { x: Types.f32, y: Types.f32, z: Types.f32 },
});

const BOX = {
  shape: { type: "box" as const, halfX: 0.5, halfY: 0.5, halfZ: 0.5 },
  colliderId: 0,
};

let physics: Physics3DAPI | undefined;
let engine: GwenEngine | undefined;

function requirePhysics(): Physics3DAPI {
  if (physics === undefined || engine === undefined) {
    throw new Error("physics3d adapter used before install");
  }
  return physics;
}

function vecOf(id: EntityId): Vec | null {
  const state = requirePhysics().getBodyState(id);
  if (state === undefined) return null;
  return { x: state.position.x, y: state.position.y, z: state.position.z };
}

runPhysicsConformance({
  variant: "physics3d",
  async install(next: GwenEngine, gravity: number): Promise<void> {
    engine = next;
    await next.use(Physics3DPlugin({ gravity: { x: 0, y: gravity, z: 0 } }));
    physics = next.inject("physics3d");
  },
  async installKinematicSync(next: GwenEngine): Promise<void> {
    await next.use(createPhysicsKinematicSyncSystem({ positionComponent: Transform3D })());
  },
  createDynamicBody(id: EntityId, at: Vec, collider: boolean): void {
    requirePhysics().createBody(id, {
      kind: "dynamic",
      initialPosition: { x: at.x, y: at.y, z: at.z ?? 0 },
      initialLinearVelocity: { x: 0, y: 0, z: 0 },
      ...(collider ? { colliders: [BOX] } : {}),
    });
  },
  createKinematicBody(id: EntityId, at: Vec): void {
    engine?.addComponent(id, Transform3D, { x: at.x, y: at.y, z: at.z ?? 0 });
    requirePhysics().createBody(id, {
      kind: "kinematic",
      initialPosition: { x: at.x, y: at.y, z: at.z ?? 0 },
    });
  },
  moveEcs(id: EntityId, to: Vec): void {
    engine?.addComponent(id, Transform3D, { x: to.x, y: to.y, z: to.z ?? 0 });
  },
  position: vecOf,
  removeBody(id: EntityId): void {
    requirePhysics().removeBody(id);
  },
  contactCount(): number {
    return requirePhysics().getCollisionContacts().length;
  },
});
