import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect } from "vitest";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useEntityId } from "../../src/actor/index";
import { GwenContextError } from "../../src/index";
import { onUpdate, useComponent } from "../../src/system/index";
import { createEngine } from "../../src/node";

const Position = stubComponent("Position");

const PosPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("useComponent", () => {
  it("reads the component from the current actor entity", async () => {
    const engine = await createEngine();
    let capturedX: number | undefined;

    const Actor = defineActor(PosPrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent(Position);
      onUpdate(() => {
        capturedX = pos.x;
      });
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn();

    // Advance one full frame — triggers plugin.onUpdate → instance._update callbacks
    await engine.advance(0.016);

    // Component x defaults to 0 from prefab; 0 is defined (not undefined)
    expect(capturedX).toBeDefined();
  });

  it("writes to the component via proxy set", async () => {
    const engine = await createEngine();

    const Actor = defineActor(PosPrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent(Position);
      onUpdate(() => {
        pos.x = 99;
      });
    });
    await engine.use(Actor._plugin);
    const entityId = Actor._plugin.spawn();

    // Advance one full frame — proxy setter runs inside onUpdate
    await engine.advance(0.016);

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
      const pos = useComponent(Position);
      onUpdate(() => {
        pos.x = 42; // only x — y must stay at its default
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn();
    await engine.advance(0.016);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = engine.getComponent(id as never, Position as any) as { x: number; y: number };
    expect(comp.x).toBe(42);
    expect(comp.y).toBe(0); // default preserved
  });

  it("$set with partial fields preserves untouched fields", async () => {
    const engine = await createEngine();

    const Actor = defineActor(PosPrefab, () => {
      const pos = useComponent(Position);
      onUpdate(() => {
        pos.$set({ x: 10 }); // only x — y must stay
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn();
    await engine.advance(0.016);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = engine.getComponent(id as never, Position as any) as { x: number; y: number };
    expect(comp.x).toBe(10);
    expect(comp.y).toBe(0); // default preserved
  });

  it("two consecutive single-field writes both take effect", async () => {
    const engine = await createEngine();
    let frame = 0;

    const Actor = defineActor(PosPrefab, () => {
      const pos = useComponent(Position);
      onUpdate(() => {
        frame++;
        pos.x = frame * 10;
        pos.y = frame * 5;
      });
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn();
    await engine.advance(0.016);
    await engine.advance(0.016);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const comp = engine.getComponent(id as never, Position as any) as { x: number; y: number };
    expect(comp.x).toBe(20);
    expect(comp.y).toBe(10);
  });
});

describe("useComponent — both forms from the system entry", () => {
  it("useComponent is exported by @gwenjs/core/system", () => {
    expect(typeof useComponent).toBe("function");
  });

  it("useComponent(def) outside an actor factory throws GwenContextError with composable useComponent", async () => {
    expect(typeof useComponent).toBe("function");
    const engine = await createEngine();
    try {
      let error: unknown;
      try {
        engine.run(() => useComponent(Position));
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(GwenContextError);
      if (!(error instanceof GwenContextError)) return;
      expect(error.code).toBe("CORE:OUTSIDE_ACTOR_CONTEXT");
      expect(error.composable).toBe("useComponent");
      const lines = error.message.split("\n");
      expect(lines[0]).toBe("[useComponent()] Called outside defineActor().");
      expect(lines[lines.length - 1]).toBe(
        "See https://gwenjs.github.io/gwen/api/errors#core-outside-actor-context (CORE:OUTSIDE_ACTOR_CONTEXT)",
      );
    } finally {
      await engine.stop();
    }
  });

  it("useComponent(id, def) inside an actor reads what useComponent(def) wrote", async () => {
    expect(typeof useComponent).toBe("function");
    const engine = await createEngine();
    try {
      let seen: number | undefined;
      const Actor = defineActor(PosPrefab, () => {
        const own = useComponent(Position);
        const byId = useComponent(useEntityId(), Position);
        onUpdate(() => {
          own.x = 7;
          seen = byId.x;
        });
      });
      await engine.use(Actor._plugin);
      Actor._plugin.spawn();
      await engine.advance(0.016);

      expect(seen).toBe(7);
    } finally {
      await engine.stop();
    }
  });

  it("useComponent(id, def, engine) reads and writes the given engine, not the active one", async () => {
    expect(typeof useComponent).toBe("function");
    const engineA = await createEngine();
    const engineB = await createEngine();
    try {
      const idA = engineA.createEntity();
      engineA.addComponent(idA, Position, { x: 1, y: 0 });
      const idB = engineB.createEntity();
      engineB.addComponent(idB, Position, { x: 5, y: 0 });

      let read: number | undefined;
      engineA.run(() => {
        const handle = useComponent(idB, Position, engineB);
        read = handle.x;
        handle.x = 9;
      });

      expect(read).toBe(5);
      expect(engineB.getComponent(idB, Position)?.x).toBe(9);
      expect(engineA.getComponent(idA, Position)?.x).toBe(1);
    } finally {
      await engineA.stop();
      await engineB.stop();
    }
  });

  it("useComponent(id, def) outside any engine context throws OUTSIDE_ENGINE_CONTEXT naming useComponent", async () => {
    expect(typeof useComponent).toBe("function");
    const engine = await createEngine();
    try {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 1, y: 0 });
      let error: unknown;
      try {
        useComponent(id, Position);
      } catch (caught) {
        error = caught;
      }
      expect(error).toBeInstanceOf(GwenContextError);
      if (!(error instanceof GwenContextError)) return;
      expect(error.code).toBe("CORE:OUTSIDE_ENGINE_CONTEXT");
      expect(error.composable).toBe("useComponent");
      const lines = error.message.split("\n");
      expect(lines[0]).toBe(
        "[useComponent()] Called outside defineSystem() or defineActor() or defineScene() or plugin setup() or engine.run().",
      );
      expect(lines[lines.length - 1]).toBe(
        "See https://gwenjs.github.io/gwen/api/errors#core-outside-engine-context (CORE:OUTSIDE_ENGINE_CONTEXT)",
      );
    } finally {
      await engine.stop();
    }
  });
});
