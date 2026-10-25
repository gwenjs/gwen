/**
 * @file Physics 3D actor composables name themselves (P-64-2b).
 */

import { afterEach, describe, expect, it } from "vitest";
import { createEngine, GwenContextError, type GwenEngine } from "@gwenjs/core";
import { Physics3DPlugin } from "../src/index.js";
import { useBoxCollider } from "../src/composables/use-box-collider.js";
import { useCapsuleCollider } from "../src/composables/use-capsule-collider.js";
import { useCompoundCollider } from "../src/composables/use-compound-collider.js";
import { useConvexCollider } from "../src/composables/use-convex-collider.js";
import { useDynamicBody } from "../src/composables/use-dynamic-body.js";
import { useHeightfieldCollider } from "../src/composables/use-heightfield-collider.js";
import { useKinematicBody } from "../src/composables/use-kinematic-body.js";
import { useMeshCollider } from "../src/composables/use-mesh-collider.js";
import { useSphereCollider } from "../src/composables/use-sphere-collider.js";
import { useStaticBody } from "../src/composables/use-static-body.js";

function thrownBy(fn: () => unknown): GwenContextError {
  let error: unknown;
  try {
    fn();
  } catch (caught) {
    error = caught;
  }
  expect(error).toBeInstanceOf(GwenContextError);
  if (!(error instanceof GwenContextError)) throw new Error("expected GwenContextError");
  return error;
}

describe("physics3d context error names", () => {
  const engines: GwenEngine[] = [];

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.stop();
  });

  async function open(): Promise<GwenEngine> {
    const engine = await createEngine({ variant: "physics3d", maxEntities: 8 });
    engines.push(engine);
    await engine.use(Physics3DPlugin());
    return engine;
  }

  it("useDynamicBody outside an actor names useDynamicBody", async () => {
    const engine = await open();
    const error = thrownBy(() => engine.run(() => useDynamicBody()));
    expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
    expect(error.composable).toBe("useDynamicBody");
  });

  it("every physics3d actor composable names itself", async () => {
    const engine = await open();
    const calls: readonly [string, () => void][] = [
      ["useBoxCollider", () => useBoxCollider({ w: 1, h: 1 })],
      ["useCapsuleCollider", () => useCapsuleCollider({ radius: 0.5, height: 1 })],
      [
        "useCompoundCollider",
        () => useCompoundCollider({ shapes: [{ type: "box", halfX: 1, halfY: 1, halfZ: 1 }] }),
      ],
      [
        "useConvexCollider",
        () => useConvexCollider({ vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]) }),
      ],
      ["useDynamicBody", () => useDynamicBody()],
      [
        "useHeightfieldCollider",
        () =>
          useHeightfieldCollider({
            heights: new Float32Array([0, 0, 0, 0]),
            rows: 2,
            cols: 2,
          }),
      ],
      ["useKinematicBody", () => useKinematicBody()],
      [
        "useMeshCollider",
        () =>
          useMeshCollider({
            vertices: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
            indices: new Uint32Array([0, 1, 2]),
          }),
      ],
      ["useSphereCollider", () => useSphereCollider({ radius: 0.5 })],
      ["useStaticBody", () => useStaticBody()],
    ];
    engine.run(() => {
      for (const [name, call] of calls) {
        const error = thrownBy(() => call());
        expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
        expect(error.composable).toBe(name);
      }
    });
  });
});
