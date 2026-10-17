import { describe, expect, it } from "vitest";

import { defineSystem, onUpdate, useQuery } from "../../src/system/index";
import { createEngine, defineComponent, Types, type EntityId, type GwenEngine } from "../../src/index";
import { setEntityDormant } from "../../src/engine/engine-internals";

const Position = defineComponent({
  name: "QueryDeferPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

const Health = defineComponent({
  name: "QueryDeferHealth",
  schema: { hp: Types.f32 },
  defaults: { hp: 1 },
});

async function withEngine(run: (engine: GwenEngine) => Promise<void>): Promise<void> {
  const engine = await createEngine({ maxEntities: 32 });
  try {
    await run(engine);
  } finally {
    await engine.stop();
  }
}

function spawn(engine: GwenEngine, x: number): EntityId {
  const id = engine.createEntity();
  engine.addComponent(id, Position, { x, y: 0 });
  return id;
}

describe("chunk loop defers structural changes", () => {
  it("a destroy before break stays alive until the loop closes", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 1);
      const seen: EntityId[] = [];
      engine.hooks.hook("entity:destroy", (destroyed) => {
        seen.push(destroyed);
      });
      const query = engine.run(() => useQuery([Position]));

      let aliveInLoop: boolean | undefined;
      let hooksInLoop = -1;
      for (const _chunk of query) {
        engine.destroyEntity(id);
        aliveInLoop = engine.isAlive(id);
        hooksInLoop = seen.length;
        break;
      }

      expect(aliveInLoop).toBe(true);
      expect(hooksInLoop).toBe(0);
      expect(engine.isAlive(id)).toBe(false);
      expect(seen).toEqual([id]);
    });
  });

  it("a destroy before a throw is applied when the iterator closes", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 1);
      const seen: EntityId[] = [];
      engine.hooks.hook("entity:destroy", (destroyed) => {
        seen.push(destroyed);
      });
      const query = engine.run(() => useQuery([Position]));

      let aliveInLoop: boolean | undefined;
      let hooksInLoop = -1;
      let thrown = "";
      try {
        for (const _chunk of query) {
          engine.destroyEntity(id);
          aliveInLoop = engine.isAlive(id);
          hooksInLoop = seen.length;
          throw new Error("mid-loop");
        }
      } catch (error: unknown) {
        thrown = error instanceof Error ? error.message : "";
      }

      expect(thrown).toBe("mid-loop");
      expect(aliveInLoop).toBe(true);
      expect(hooksInLoop).toBe(0);
      expect(engine.isAlive(id)).toBe(false);
      expect(seen).toEqual([id]);
    });
  });

  it("an inner loop close does not apply a queued destroy", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 1);
      const query = engine.run(() => useQuery([Position]));
      const inner = engine.run(() => useQuery([Position]));

      let aliveAfterInner: boolean | undefined;
      for (const _outer of query) {
        for (const _chunk of inner) {
          engine.destroyEntity(id);
        }
        aliveAfterInner = engine.isAlive(id);
        break;
      }

      expect(aliveAfterInner).toBe(true);
      expect(engine.isAlive(id)).toBe(false);
    });
  });

  it("the next system in the frame sees a destroy applied at the end of the first loop", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 1);
      let aliveDuringWriter: boolean | undefined;
      let aliveDuringReader: boolean | undefined;

      await engine.use(
        defineSystem("defer-writer", () => {
          const query = useQuery([Position]);
          onUpdate(() => {
            for (const _chunk of query) {
              engine.destroyEntity(id);
              aliveDuringWriter = engine.isAlive(id);
            }
          });
        })(),
      );
      await engine.use(
        defineSystem("defer-reader", () => {
          onUpdate(() => {
            aliveDuringReader = engine.isAlive(id);
          });
        })(),
      );

      await engine.startExternal();
      await engine.advance(0.016);

      expect(aliveDuringWriter).toBe(true);
      expect(aliveDuringReader).toBe(false);
    });
  });

  it("destroy if dead still visits the row and fires entity:destroy once after the loop", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 1);
      engine.addComponent(id, Health, { hp: 0 });
      const seen: EntityId[] = [];
      engine.hooks.hook("entity:destroy", (destroyed) => {
        seen.push(destroyed);
      });
      const query = engine.run(() => useQuery([Position, Health]));

      let visited = 0;
      let aliveInLoop: boolean | undefined;
      for (const chunk of query) {
        const cols = chunk.get(Health) as { hp?: Float32Array };
        const hp = cols.hp;
        if (!(hp instanceof Float32Array)) continue;
        for (let row = 0; row < chunk.count; row += 1) {
          visited += 1;
          if ((hp[row] ?? 1) <= 0) engine.destroyEntity(chunk.entityId(row));
        }
        aliveInLoop = engine.isAlive(id);
      }

      expect(visited).toBe(1);
      expect(aliveInLoop).toBe(true);
      expect(engine.isAlive(id)).toBe(false);
      expect(seen).toEqual([id]);
    });
  });

  it("an add queued after a destroy does not bring the component back", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 4);
      const query = engine.run(() => useQuery([Position]));

      let presentInLoop: number | undefined;
      let secondDestroy: boolean | undefined;
      for (const _chunk of query) {
        engine.destroyEntity(id);
        engine.addComponent(id, Position, { x: 9, y: 9 });
        presentInLoop = engine.getComponent(id, Position)?.x;
        secondDestroy = engine.destroyEntity(id);
      }

      expect(presentInLoop).toBe(4);
      expect(secondDestroy).toBe(false);
      expect(engine.isAlive(id)).toBe(false);
      expect(engine.getComponent(id, Position)).toBeUndefined();
    });
  });

  it("createEntity returns an id that stays invisible until the loop closes", async () => {
    await withEngine(async (engine) => {
      const existing = spawn(engine, 1);
      const query = engine.run(() => useQuery([Position]));

      let created: EntityId | undefined;
      let aliveInLoop: boolean | undefined;
      let seenInLoop = 0;
      for (const chunk of query) {
        engine.destroyEntity(existing);
        created = engine.createEntity();
        engine.addComponent(created, Position, { x: 6, y: 7 });
        aliveInLoop = engine.isAlive(created);
        for (const again of query) seenInLoop += again.count;
        void chunk;
      }

      expect(created).toBeDefined();
      expect(aliveInLoop).toBe(false);
      expect(seenInLoop).toBe(1);
      expect(engine.isAlive(created as EntityId)).toBe(true);
      expect(engine.getComponent(created as EntityId, Position)?.x).toBe(6);
      expect(engine.isAlive(existing)).toBe(false);
    });
  });

  it("a remove stays visible until the loop closes", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 2);
      const kept = spawn(engine, 5);
      const query = engine.run(() => useQuery([Position]));

      let presentInLoop: boolean | undefined;
      let patched: number | undefined;
      for (const _chunk of query) {
        engine.removeComponent(id, Position);
        presentInLoop = engine.hasComponent(id, Position);
        engine.addComponent(kept, Position, { x: 8, y: 1 });
        patched = engine.getComponent(kept, Position)?.x;
      }

      expect(presentInLoop).toBe(true);
      expect(patched).toBe(8);
      expect(engine.hasComponent(id, Position)).toBe(false);
      expect(engine.isAlive(id)).toBe(true);
    });
  });

  it("a dormancy toggle stays awake for a nested query and drops after the outer loop", async () => {
    await withEngine(async (engine) => {
      const id = spawn(engine, 3);
      const query = engine.run(() => useQuery([Position]));

      let nested = 0;
      for (const _chunk of query) {
        expect(setEntityDormant(engine, id, true)).toBe(true);
        for (const inner of query) nested += inner.count;
        break;
      }

      expect(nested).toBe(1);
      let after = 0;
      for (const chunk of query) after += chunk.count;
      expect(after).toBe(0);
      expect(engine.isAlive(id)).toBe(true);
    });
  });

});
