import { defineComponent, Types, type EntityId } from "../../src/index.js";
import type { GwenEngine } from "../../src/engine/gwen-engine.js";
import "../../../physics2d/src/augment";
import { Physics2DPlugin } from "../../../physics2d/src/plugin/index";
import { createPhysicsKinematicSyncSystem } from "../../../physics2d/src/systems";
import type { Physics2DAPI } from "../../../physics2d/src/types";
import { runPhysicsConformance, type Vec } from "./physics-conformance.js";

const Position2D = defineComponent({
  name: "position",
  schema: { x: Types.f32, y: Types.f32 },
});

let physics: Physics2DAPI | undefined;
let engine: GwenEngine | undefined;

function requirePhysics(): Physics2DAPI {
  if (physics === undefined || engine === undefined) {
    throw new Error("physics2d adapter used before install");
  }
  return physics;
}

runPhysicsConformance({
  variant: "physics2d",
  async install(next: GwenEngine, gravity: number): Promise<void> {
    engine = next;
    await next.use(Physics2DPlugin({ gravity }));
    physics = next.inject("physics2d");
  },
  async installKinematicSync(next: GwenEngine): Promise<void> {
    await next.use(createPhysicsKinematicSyncSystem({ pixelsPerMeter: 1 }));
  },
  createDynamicBody(id: EntityId, at: Vec, collider: boolean): void {
    const api = requirePhysics();
    const handle = api.addRigidBody(id, "dynamic", at.x, at.y);
    if (collider) api.addBoxCollider(handle, 0.5, 0.5);
  },
  createKinematicBody(id: EntityId, at: Vec): void {
    const api = requirePhysics();
    engine?.addComponent(id, Position2D, { x: at.x, y: at.y });
    api.addRigidBody(id, "kinematic", at.x, at.y);
  },
  moveEcs(id: EntityId, to: Vec): void {
    engine?.addComponent(id, Position2D, { x: to.x, y: to.y });
  },
  position(id: EntityId): Vec | null {
    const found = requirePhysics().getPosition(id);
    if (found === null) return null;
    return { x: found.x, y: found.y };
  },
  removeBody(id: EntityId): void {
    requirePhysics().removeBody(id);
  },
  contactCount(): number {
    return requirePhysics().getCollisionContacts().length;
  },
});
