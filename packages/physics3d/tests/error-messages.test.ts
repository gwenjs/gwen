import { afterEach, describe, expect, it } from "vitest";
import {
  createEngine,
  defineComponent,
  GwenContextError,
  Types,
  type GwenEngine,
} from "@gwenjs/core";
import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { GwenError } from "@gwenjs/schema";
import { usePhysics3D } from "../src/composables";
import { useCompoundCollider } from "../src/composables/use-compound-collider";
import { useMeshCollider } from "../src/composables/use-mesh-collider";
import { useStaticBody } from "../src/composables/use-static-body";
import { Physics3DErrorCodes } from "../src/errors/codes";
import { encodeCompoundShapes } from "../src/helpers/compound";
import { Physics3DPlugin, preloadMeshCollider } from "../src/index";
import { Physics3DStaleEntityError } from "../src/plugin/entity-owner";
import type { MeshColliderHandle3D } from "../src/types";

const engines: GwenEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

function gwen(run: () => unknown): GwenError {
  let error: unknown;
  try {
    error = run();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GwenError);
  if (!(error instanceof GwenError)) throw new Error("expected GwenError");
  return error;
}

async function caught(run: () => unknown): Promise<unknown> {
  try {
    return await run();
  } catch (error) {
    return error;
  }
}

function head(error: GwenError): string {
  return error.message.split("\n")[0] ?? "";
}

async function open() {
  const engine = await createEngine({ variant: "physics3d", maxEntities: 8 });
  engines.push(engine);
  await engine.use(Physics3DPlugin());
  return engine;
}

function makeActor(name: string, run: () => void) {
  const Tag = defineComponent({ name, schema: { x: Types.f32 } });
  return defineActor(definePrefab([{ def: Tag, defaults: { x: 0 } }]), run);
}

describe("physics3d error messages", () => {
  it("useCompoundCollider without a rigid body throws PHYSICS3D:NO_RIGID_BODY naming useCompoundCollider", async () => {
    const engine = await open();
    const Actor = makeActor("P64CompoundBody", () => {
      useCompoundCollider({ shapes: [{ type: "box", halfX: 1, halfY: 1, halfZ: 1 }] });
    });
    await engine.use(Actor._plugin);
    const error = gwen(() => engine.run(() => Actor._plugin.spawn()));
    expect(error.code).toBe(Physics3DErrorCodes.NO_RIGID_BODY);
    expect(error.composable).toBe("useCompoundCollider");
    const line = head(error);
    expect(line).toBe("[useCompoundCollider()] No rigid body found for this entity.");
    expect(line).not.toContain("[GWEN:");
  });

  it("an invalid compound throws PHYSICS3D:INVALID_COMPOUND", () => {
    const error = gwen(() => encodeCompoundShapes([{ type: "sphere", radius: 1 }], []));
    expect(error.code).toBe(Physics3DErrorCodes.INVALID_COMPOUND);
    expect(error.composable).toBeUndefined();
    expect(head(error)).toBe("[GWEN] shapes.length (1) must equal colliderIds.length (0).");
  });

  it("a mesh rebuild after removeBody throws PHYSICS3D:MESH_REBUILD_FAILED with no cause", async () => {
    const engine = await open();
    const vertices = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]);
    const indices = new Uint32Array([0, 1, 2]);
    let handle: MeshColliderHandle3D | undefined;
    const Actor = makeActor("P64MeshRebuild", () => {
      useStaticBody();
      handle = useMeshCollider({ vertices, indices });
    });
    await engine.use(Actor._plugin);
    const id = engine.run(() => Actor._plugin.spawn());
    engine.run(() => engine.inject("physics3d").removeBody(id));
    const mesh = handle;
    if (mesh === undefined) throw new Error("missing mesh handle");
    const rebuilt = await caught(() => mesh.rebuild(vertices, indices));
    expect(rebuilt).toBeInstanceOf(GwenError);
    if (!(rebuilt instanceof GwenError)) return;
    expect(rebuilt.code).toBe(Physics3DErrorCodes.MESH_REBUILD_FAILED);
    expect(rebuilt.composable).toBe("useMeshCollider");
    expect(rebuilt.cause).toBeUndefined();
    expect(head(rebuilt)).toBe(
      `[useMeshCollider()] Mesh collider rebuild failed for entity ${String(id)}, collider ${mesh.colliderId}.`,
    );
  });

  it("a stale entity error has no code in its text", async () => {
    const engine = await open();
    const physics = engine.inject("physics3d");
    const id = engine.createEntity();
    expect(engine.destroyEntity(id)).toBe(true);
    const error = gwen(() => physics.applyImpulse(id, { x: 1 }));
    expect(error).toBeInstanceOf(Physics3DStaleEntityError);
    expect(error.code).toBe(Physics3DErrorCodes.STALE_ENTITY);
    expect(head(error)).toContain("applyImpulse");
    expect(head(error)).not.toContain("PHYSICS3D:");
    expect(error.message.split("\n").at(-1)).toMatch(/\(PHYSICS3D:STALE_ENTITY\)$/);
  });

  it.each([
    ["usePhysics3D", () => usePhysics3D()],
    ["preloadMeshCollider", () => preloadMeshCollider("/assets/x.bin")],
    [
      "Physics3DPlugin.setup",
      async () => {
        const engine = await createEngine({ maxEntities: 4 });
        engines.push(engine);
        await Physics3DPlugin().setup(engine);
      },
    ],
  ] as const)("%s names itself", async (name, call) => {
    const error = await caught(call);
    expect(error).toBeInstanceOf(GwenContextError);
    if (!(error instanceof GwenContextError)) return;
    expect(error.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    expect(error.composable).toBe(name);
    expect(error.message.startsWith(`[${name}()]`)).toBe(true);
  });
});
