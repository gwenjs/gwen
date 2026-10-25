/**
 * @file onContact names the composable and CORE:OUTSIDE_ACTOR_CONTEXT (P-64-2a).
 */

import { afterEach, describe, expect, it } from "vitest";
import { createEngine, type GwenEngine } from "@gwenjs/core";
import { onContact } from "../src/composables/on-contact.js";

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
