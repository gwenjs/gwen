import { afterEach, describe, expect, it } from "vitest";
import type { GwenEngine } from "../../src/engine/engine-types.js";
import { createEngineLocal } from "../../src/engine/engine-local.js";
import { engineLocalCount } from "../../src/hmr/engine-local-count.js";
import { createEngine } from "../../src/node.js";

const engines: GwenEngine[] = [];

afterEach(async () => {
  for (const engine of engines.splice(0)) await engine.stop();
});

describe.runIf(__GWEN_DEV__)("engineLocalCount", () => {
  it("counts one entry per EngineLocal value and drops them at stop()", async () => {
    const engine = await createEngine();
    engines.push(engine);
    const before = engineLocalCount(engine);
    const first = createEngineLocal(() => 1);
    const second = createEngineLocal(() => 2);
    first.get(engine);
    second.get(engine);

    expect(engineLocalCount(engine)).toBe(before + 2);
    await engine.stop();
    expect(engineLocalCount(engine)).toBe(0);
  });

  it("two engines count independently", async () => {
    const left = await createEngine();
    const right = await createEngine();
    engines.push(left, right);
    const local = createEngineLocal(() => "mark");
    const rightBefore = engineLocalCount(right);
    local.get(left);

    expect(engineLocalCount(left)).toBe(engineLocalCount(right) + 1);
    expect(engineLocalCount(right)).toBe(rightBefore);
  });
});
