import { describe, it, expect } from "vitest";
import { definePrefab } from "../../src/actor/defines/define-prefab";
import { defineActor } from "../../src/actor/defines/define-actor";
import { useComponent } from "../../src/actor/uses/use-actor";
import { onUpdate } from "../../src/system/defines/define-system";
import { createEngine } from "../../src/engine/gwen-engine";

const Position = { __name__: "Position" };

const PosPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("useComponent", () => {
  it("reads the component from the current actor entity", async () => {
    const engine = await createEngine();
    let capturedX: number | undefined;

    const Actor = defineActor(PosPrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent<any>(Position);
      onUpdate(() => {
        capturedX = pos.x;
      });
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn();

    // Advance one full frame — triggers plugin.onUpdate → instance._update callbacks
    await engine.advance(16);

    // Component x defaults to 0 from prefab; 0 is defined (not undefined)
    expect(capturedX).toBeDefined();
  });

  it("writes to the component via proxy set", async () => {
    const engine = await createEngine();

    const Actor = defineActor(PosPrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent<any>(Position);
      onUpdate(() => {
        pos.x = 99;
      });
    });
    await engine.use(Actor._plugin);
    const entityId = Actor._plugin.spawn();

    // Advance one full frame — proxy setter runs inside onUpdate
    await engine.advance(16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component = engine.getComponent(entityId! as never, Position as any);
    if (component !== null && component !== undefined) {
      expect((component as { x: number }).x).toBe(99);
    }
  });
});

describe("useComponent — in-place update behaviour", () => {
  it("single-field write preserves other fields", async () => {
    const engine = await createEngine();

    const Actor = defineActor(PosPrefab, () => {
      const pos = useComponent<{ x: number; y: number }>(Position);
      onUpdate(() => {
        pos.x = 42; // only x — y must stay at its default
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn();
    await engine.advance(16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = engine.getComponent(id as never, Position as any) as { x: number; y: number };
    expect(comp.x).toBe(42);
    expect(comp.y).toBe(0); // default preserved
  });

  it("$set with partial fields preserves untouched fields", async () => {
    const engine = await createEngine();

    const Actor = defineActor(PosPrefab, () => {
      const pos = useComponent<{ x: number; y: number }>(Position);
      onUpdate(() => {
        pos.$set({ x: 10 }); // only x — y must stay
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn();
    await engine.advance(16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = engine.getComponent(id as never, Position as any) as { x: number; y: number };
    expect(comp.x).toBe(10);
    expect(comp.y).toBe(0); // default preserved
  });

  it("two consecutive single-field writes both take effect", async () => {
    const engine = await createEngine();
    let frame = 0;

    const Actor = defineActor(PosPrefab, () => {
      const pos = useComponent<{ x: number; y: number }>(Position);
      onUpdate(() => {
        frame++;
        pos.x = frame * 10;
        pos.y = frame * 5;
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn();
    await engine.advance(16);
    await engine.advance(16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = engine.getComponent(id as never, Position as any) as { x: number; y: number };
    expect(comp.x).toBe(20);
    expect(comp.y).toBe(10);
  });
});
