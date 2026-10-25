/**
 * @file onContact names the composable and CORE:OUTSIDE_ACTOR_CONTEXT (P-64-2a).
 */

import { afterEach, describe, expect, it } from "vitest";
import { createEngine, GwenContextError, type GwenEngine } from "@gwenjs/core";
import { Physics2DPlugin } from "../src/index.js";
import { onContact } from "../src/composables/on-contact.js";
import { useBoxCollider } from "../src/composables/use-box-collider.js";
import { useCapsuleCollider } from "../src/composables/use-capsule-collider.js";
import { useDynamicBody } from "../src/composables/use-dynamic-body.js";
import { useKinematicBody } from "../src/composables/use-kinematic-body.js";
import { useShape } from "../src/composables/use-shape.js";
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

describe("onContact context", () => {
  const engines: GwenEngine[] = [];

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.stop();
  });

  it("onContact without an actor names onContact and CORE:OUTSIDE_ACTOR_CONTEXT", async () => {
    const engine = await createEngine();
    engines.push(engine);
    expect(() => engine.run(() => onContact(() => {}))).toThrow(
      /^\[onContact\(\)\] Called outside defineActor\(\)\.[\s\S]*\(CORE:OUTSIDE_ACTOR_CONTEXT\)$/,
    );
  });
});

describe("physics2d actor composable names", () => {
  const engines: GwenEngine[] = [];

  afterEach(async () => {
    for (const engine of engines.splice(0)) await engine.stop();
  });

  it("every physics2d actor composable names itself", async () => {
    const engine = await createEngine({ variant: "physics2d", maxEntities: 8 });
    engines.push(engine);
    await engine.use(Physics2DPlugin());
    const calls: readonly [string, () => void][] = [
      ["useBoxCollider", () => useBoxCollider({ w: 1, h: 1 })],
      ["useCapsuleCollider", () => useCapsuleCollider({ radius: 1, height: 2 })],
      ["useDynamicBody", () => useDynamicBody()],
      ["useKinematicBody", () => useKinematicBody()],
      ["useShape", () => useShape({})],
      ["useSphereCollider", () => useSphereCollider({ radius: 1 })],
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
