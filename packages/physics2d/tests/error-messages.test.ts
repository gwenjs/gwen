import { afterEach, describe, expect, it } from "vitest";
import { createEngine, GwenContextError, type GwenEngine } from "@gwenjs/core";
import { GwenError } from "@gwenjs/schema";
import { LayerRegistry } from "../src/config";
import { usePhysics2D } from "../src/composables";
import * as contact from "../src/composables/on-contact";
import * as sensor from "../src/composables/on-sensor";
import { useShape } from "../src/composables/use-shape";
import { useStaticBody } from "../src/composables/use-static-body";
import * as errors from "../src/errors";
import { Physics2DPlugin } from "../src/index";
import { addPrefabCollider as pluginAdd } from "../src/plugin/prefab";
import { addPrefabCollider } from "../src/prefab";
import * as systems from "../src/systems";
import type { Physics2DAPI } from "../src/types";

const engines: GwenEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

function bare(): Physics2DAPI {
  const noop = (): undefined => undefined;
  return { addBallCollider: noop, addBoxCollider: noop } as Physics2DAPI;
}

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

function seeCode(error: GwenError, operation: string, code: string): void {
  expect(head(error)).toContain(operation);
  expect(head(error)).not.toContain("PHYSICS2D:");
  expect(error.message.split("\n").at(-1)).toMatch(new RegExp(`\\(${code}\\)$`));
}

async function started() {
  const engine = await createEngine({ variant: "physics2d", maxEntities: 8 });
  engines.push(engine);
  await engine.use(Physics2DPlugin());
  return { engine, api: engine.inject("physics2d") };
}

describe("physics2d error messages", () => {
  it("an unknown layer throws PHYSICS2D:UNKNOWN_LAYER whose first line has no [Physics2D] tag", () => {
    const error = gwen(() =>
      addPrefabCollider(
        bare(),
        1,
        { id: "membership", shape: "ball", radius: 8, membershipLayers: ["unknown_layer"] },
        new LayerRegistry({ player: 0, ground: 1 }),
      ),
    );
    expect(error.code).toBe(errors.Physics2DErrorCodes.UNKNOWN_LAYER);
    expect(head(error).startsWith('[GWEN] Unknown layer "unknown_layer"')).toBe(true);
    expect(head(error)).not.toContain("[Physics2D]");
  });

  it("a stale entity error has no code in its text", async () => {
    const { engine, api } = await started();
    const id = engine.createEntity();
    expect(engine.destroyEntity(id)).toBe(true);
    const error = gwen(() => api.addRigidBody(id, "dynamic", 0, 0));
    expect(error).toBeInstanceOf(errors.Physics2DStaleEntityError);
    expect(error.code).toBe(errors.Physics2DErrorCodes.STALE_ENTITY);
    seeCode(error, "addRigidBody", "PHYSICS2D:STALE_ENTITY");
  });

  it("a stale body handle error has no code in its text", async () => {
    const { engine, api } = await started();
    const id = engine.createEntity();
    const handle = api.addRigidBody(id, "dynamic", 0, 0);
    api.removeBody(id);
    const error = gwen(() => api.addBoxCollider(handle, 0.5, 0.5));
    expect(error).toBeInstanceOf(errors.Physics2DStaleBodyHandleError);
    expect(error.code).toBe(errors.Physics2DErrorCodes.STALE_BODY_HANDLE);
    seeCode(error, "addBoxCollider", "PHYSICS2D:STALE_BODY_HANDLE");
  });

  it("an invalid collider throws PHYSICS2D:INVALID_COLLIDER with no composable", () => {
    const registry = new LayerRegistry({});
    for (const add of [addPrefabCollider, pluginAdd]) {
      const error = gwen(() => add(bare(), 1, { id: "ball-1", shape: "ball" }, registry));
      expect(error.code).toBe(errors.Physics2DErrorCodes.INVALID_COLLIDER);
      expect(error.composable).toBeUndefined();
      expect(head(error).startsWith("[GWEN] Invalid collider config")).toBe(true);
    }
  });

  it("createPhysicsKinematicSyncSystem without positionComponent throws PHYSICS2D:POSITION_COMPONENT_REQUIRED naming createPhysicsKinematicSyncSystem", () => {
    const error = gwen(() =>
      systems.createPhysicsKinematicSyncSystem({} as systems.PhysicsKinematicSyncSystemOptions),
    );
    expect(error.code).toBe(errors.Physics2DErrorCodes.POSITION_COMPONENT_REQUIRED);
    expect(error.composable).toBe("createPhysicsKinematicSyncSystem");
    expect(head(error)).toBe("[createPhysicsKinematicSyncSystem()] positionComponent is required.");
  });

  it.each([
    ["usePhysics2D", () => usePhysics2D()],
    ["useStaticBody", () => useStaticBody()],
    ["Physics2DPlugin.teardown", () => Physics2DPlugin().teardown()],
    ["Physics2DPlugin", () => sensor._dispatchSensorEnter(1, 1n)],
    ["Physics2DPlugin", () => sensor._dispatchSensorExit(1, 1n)],
    ["Physics2DPlugin", () => sensor._clearSensorCallbacks(1)],
    [
      "Physics2DPlugin",
      () => contact._dispatchContactEvent(1n, { entityA: 1n, entityB: 2n, started: true }),
    ],
    ["onContact", () => contact.onContact(() => undefined)],
    ["Physics2DPlugin", () => contact._clearContactCallbacks(1n)],
    ["useShape", () => useShape({})],
  ] as const)("%s names itself", async (name, call) => {
    const error = await caught(call);
    expect(error).toBeInstanceOf(GwenContextError);
    if (!(error instanceof GwenContextError)) return;
    expect(error.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
    expect(error.composable).toBe(name);
    expect(error.message.startsWith(`[${name}()]`)).toBe(true);
  });
});
