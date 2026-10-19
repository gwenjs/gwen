import { describe, expect, it } from "vitest";
import { defineLayout } from "../../src/actor/runtime/define-layout.js";
import { placeGroup } from "../../src/actor/runtime/place.js";
import { useLayout } from "../../src/actor/runtime/use-layout.js";
import type { PlaceHandle } from "../../src/actor/runtime/types.js";
import { createRealEngine, type RealEngineHandle } from "./harness.js";

const FRAME = 1 / 60;
type RealEngine = RealEngineHandle["engine"];

/** Runs `body` on a fresh real-WASM engine and disposes it in `finally`. */
async function withRealEngine(body: (engine: RealEngine) => Promise<void>): Promise<void> {
  const handle = await createRealEngine({ variant: "light", maxEntities: 256 });
  try {
    await body(handle.engine);
  } finally {
    await handle.dispose();
  }
}

function groupsLayout(count: number) {
  return defineLayout(() => {
    const refs: Record<string, PlaceHandle<void>> = {};
    for (let i = 0; i < count; i++) refs[`g${i}`] = placeGroup({ at: [i, 0] });
    return refs;
  });
}

describe("useLayout chunkSize on the real WASM bridge", () => {
  it("spawns one chunk per frame and bulk_destroy removes the entities on dispose mid-load", async () => {
    await withRealEngine(async (engine) => {
      const base = engine.getStats().entityCount;
      await engine.run(async () => {
        const handle = useLayout(groupsLayout(5), { lazy: true, chunkSize: 2 });
        const loading = handle.load();
        await engine.advance(FRAME);
        expect(engine.getStats().entityCount - base).toBe(2);
        await handle.dispose();
        await loading;
        expect(engine.getStats().entityCount - base).toBe(0);
        expect(handle.active).toBe(false);
      });
    });
  });

  it("a spawn that throws destroys the entities already spawned, parent included", async () => {
    await withRealEngine(async (engine) => {
      const base = engine.getStats().entityCount;
      await engine.run(async () => {
        const layout = defineLayout(() => {
          const root = placeGroup({ at: [10, 0] });
          const child = placeGroup({ at: [1, 1], parent: root });
          const bad = placeGroup({
            get at(): [number, number] {
              throw new Error("bad at");
            },
          });
          return { root, child, bad };
        });
        const handle = useLayout(layout, { lazy: true, chunkSize: 5 });
        const outcome = handle.load().then(
          () => undefined,
          (rejection: unknown) => rejection,
        );
        await engine.advance(FRAME);
        expect(await outcome).toMatchObject({ message: "bad at" });
        expect(engine.getStats().entityCount - base).toBe(0);
      });
    });
  });

  it("a fully loaded progressive layout with a parent chain loads and disposes cleanly", async () => {
    await withRealEngine(async (engine) => {
      const base = engine.getStats().entityCount;
      await engine.run(async () => {
        const layout = defineLayout(() => {
          const root = placeGroup({ at: [10, 0] });
          const child = placeGroup({ at: [1, 1], parent: root });
          return { root, child };
        });
        const handle = useLayout(layout, { lazy: true, chunkSize: 1 });
        const loading = handle.load();
        await engine.advance(FRAME);
        expect(engine.getStats().entityCount - base).toBe(1);
        await engine.advance(FRAME);
        await loading;
        expect(engine.getStats().entityCount - base).toBe(2);
        await handle.dispose();
        expect(engine.getStats().entityCount - base).toBe(0);
      });
    });
  });
});
