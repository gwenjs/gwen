import { describe, expect, it } from "vitest";

import {
  createEngine,
  defineComponent,
  Types,
  type EntityId,
  type GwenEngine,
} from "../../src/index";
import { useQuery } from "../../src/system/index";
import { readLoopDepth, readStructuralCompares } from "../../src/engine/engine-internals";
import { entityGeneration, entityIndex } from "../../src/types/entity";
import type { WasmBridgeImpl } from "../../src/engine/wasm-bridge";

const Position = defineComponent({
  name: "ReviewDeferPos",
  schema: { x: Types.f32, y: Types.f32 },
  defaults: { x: 0, y: 0 },
});

function bridgeOf(engine: GwenEngine): WasmBridgeImpl {
  const bridge = engine.tryInject("wasm:bridge");
  if (bridge === undefined) throw new Error("missing bridge");
  return bridge;
}

async function withEngine(run: (engine: GwenEngine) => Promise<void>): Promise<void> {
  const engine = await createEngine({ maxEntities: 32 });
  try {
    await run(engine);
  } finally {
    await engine.stop();
  }
}

describe("deferred structural review", () => {
  it("a second add inside the loop does not mutate the caller's object", async () => {
    await withEngine(async (engine) => {
      const anchor = engine.createEntity();
      engine.addComponent(anchor, Position, { x: 0, y: 0 });
      const id = engine.createEntity();
      const query = engine.run(() => useQuery([Position]));
      const first = { x: 1 };
      let presentDuring = true;

      for (const _chunk of query) {
        engine.addComponent(id, Position, first);
        engine.addComponent(id, Position, { y: 2 });
        presentDuring = engine.hasComponent(id, Position);
        break;
      }

      expect(first).toEqual({ x: 1 });
      expect(presentDuring).toBe(false);
      expect(engine.getComponent(id, Position)).toEqual({ x: 1, y: 2 });
    });
  });

  it("ten thousand queued adds compare a bounded number of keys", async () => {
    const engine = await createEngine({ maxEntities: 12_000 });
    try {
      const anchor = engine.createEntity();
      engine.addComponent(anchor, Position, { x: 0, y: 0 });
      const ids: EntityId[] = [];
      for (let index = 0; index < 10_000; index += 1) ids.push(engine.createEntity());
      const query = engine.run(() => useQuery([Position]));

      for (const _chunk of query) {
        for (let index = 0; index < ids.length; index += 1) {
          const id = ids[index];
          if (id === undefined) continue;
          engine.addComponent(id, Position, { x: 1 });
        }
        break;
      }

      expect(readStructuralCompares(engine)).toBe(0);
    } finally {
      await engine.stop();
    }
  }, 60_000);

  it("a throwing entity:destroy hook during the flush reaches the caller and the later destroy still applies", async () => {
    await withEngine(async (engine) => {
      const first = engine.createEntity();
      const second = engine.createEntity();
      engine.addComponent(first, Position, { x: 1, y: 0 });
      engine.addComponent(second, Position, { x: 2, y: 0 });
      engine.hooks.hook("entity:destroy", (id) => {
        if (id === first) throw new Error("destroy hook failed");
      });
      const query = engine.run(() => useQuery([Position]));
      let thrown = "";

      try {
        for (const _chunk of query) {
          engine.destroyEntity(first);
          engine.destroyEntity(second);
          break;
        }
      } catch (error: unknown) {
        thrown = error instanceof Error ? error.message : "";
      }

      expect(thrown).toBe("destroy hook failed");
      expect(engine.isAlive(first)).toBe(false);
      expect(engine.isAlive(second)).toBe(false);
      expect(engine.state).toBe("idle");
    });
  });

  it("stop inside an open chunk loop drops the queue and leaves the other engine alone", async () => {
    const engine = await createEngine({ maxEntities: 16 });
    const other = await createEngine({ maxEntities: 16 });
    try {
      const id = engine.createEntity();
      engine.addComponent(id, Position, { x: 1, y: 0 });
      const otherId = other.createEntity();
      other.addComponent(otherId, Position, { x: 4, y: 0 });
      const bridge = bridgeOf(engine);
      let deletes = 0;
      const original = bridge.deleteEntity.bind(bridge);
      bridge.deleteEntity = (index: number, generation: number): boolean => {
        deletes += 1;
        return original(index, generation);
      };
      const query = engine.run(() => useQuery([Position]));
      let thrown = "";

      try {
        for (const _chunk of query) {
          engine.destroyEntity(id);
          await engine.stop();
          break;
        }
      } catch (error: unknown) {
        thrown = error instanceof Error ? error.message : "";
      }

      expect(deletes).toBe(0);
      expect(thrown).toBe("");
      expect(readLoopDepth(engine)).toBe(0);
      expect(other.getComponent(otherId, Position)).toEqual({ x: 4, y: 0 });
      expect(other.isAlive(otherId)).toBe(true);
    } finally {
      await engine.stop();
      await other.stop();
    }
  });

  it("two engines keep separate queues", async () => {
    const left = await createEngine({ maxEntities: 16 });
    const right = await createEngine({ maxEntities: 16 });
    try {
      const leftId = left.createEntity();
      const rightId = right.createEntity();
      left.addComponent(leftId, Position, { x: 1, y: 0 });
      right.addComponent(rightId, Position, { x: 2, y: 0 });
      const leftQuery = left.run(() => useQuery([Position]));
      const rightQuery = right.run(() => useQuery([Position]));
      let rightAliveInside = false;
      let leftAliveAfterRight = false;

      for (const _chunk of leftQuery) {
        left.destroyEntity(leftId);
        for (const _inner of rightQuery) {
          right.destroyEntity(rightId);
          rightAliveInside = right.isAlive(rightId);
        }
        leftAliveAfterRight = left.isAlive(leftId);
        break;
      }

      expect(rightAliveInside).toBe(true);
      expect(right.isAlive(rightId)).toBe(false);
      expect(leftAliveAfterRight).toBe(true);
      expect(left.isAlive(leftId)).toBe(false);
    } finally {
      await left.stop();
      await right.stop();
    }
  });
});

type Op =
  | { kind: "create" }
  | { kind: "destroy" }
  | { kind: "spawn"; count: number }
  | { kind: "wipe"; count: number };

interface Live {
  index: number;
  generation: number;
  id: EntityId | null;
  origin: "create" | "spawn";
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = error.code;
    if (typeof code === "string") return code;
  }
  return "throw";
}

function play(
  engine: GwenEngine,
  loop: boolean,
  ops: readonly Op[],
  seedLive: Live[],
): { trace: string[]; spawnAlive: boolean | null; live: Live[] } {
  const bridge = bridgeOf(engine);
  const live = seedLive.slice();
  const trace: string[] = [];
  let spawnAlive: boolean | null = null;

  const step = (): void => {
    for (const op of ops) {
      try {
        if (op.kind === "create") {
          if (loop) {
            const id = engine.createEntity();
            trace.push(`c:${entityIndex(id)}:${entityGeneration(id)}`);
            live.push({
              index: entityIndex(id),
              generation: entityGeneration(id),
              id,
              origin: "create",
            });
          } else {
            const created = bridge.createEntity();
            trace.push(`c:${created.index}:${created.generation}`);
            live.push({
              index: created.index,
              generation: created.generation,
              id: null,
              origin: "create",
            });
          }
          continue;
        }
        if (op.kind === "destroy") {
          let found = -1;
          for (let index = live.length - 1; index >= 0; index -= 1) {
            if (live[index]?.origin === "create") {
              found = index;
              break;
            }
          }
          const item = found >= 0 ? live.splice(found, 1)[0] : undefined;
          if (item === undefined) {
            trace.push("d:none");
            continue;
          }
          const removed =
            loop && item.id !== null
              ? engine.destroyEntity(item.id)
              : bridge.deleteEntity(item.index, item.generation);
          trace.push(`d:${removed ? 1 : 0}`);
          continue;
        }
        if (op.kind === "spawn") {
          const positions = new Float32Array(op.count * 2);
          const rotations = new Float32Array(op.count);
          const indices = bridge.bulkSpawnWithTransforms(positions, rotations);
          const parts: string[] = [];
          for (let index = 0; index < indices.length; index += 1) {
            const slot = indices[index] ?? 0;
            parts.push(String(slot));
            const generation = loop ? 0 : bridge.getEntityGeneration(slot);
            live.push({ index: slot, generation, id: null, origin: "spawn" });
          }
          trace.push(`s:${parts.join(".")}`);
          if (loop && indices.length > 0) {
            spawnAlive = bridge.isAlive(indices[0] ?? 0, 0);
          }
          continue;
        }
        const count = Math.min(op.count, live.length);
        const indices = new Uint32Array(count);
        for (let index = 0; index < count; index += 1) {
          const item = live.pop();
          indices[index] = item?.index ?? 0;
        }
        bridge.bulkDestroy(indices);
        trace.push(`w:${Array.from(indices).join(".")}`);
      } catch (error: unknown) {
        trace.push(`e:${errorCode(error)}`);
      }
    }
  };

  if (!loop) {
    step();
    return { trace, spawnAlive, live };
  }
  const query = engine.run(() => useQuery([Position]));
  for (const _chunk of query) {
    step();
    break;
  }
  return { trace, spawnAlive, live };
}

function sequences(): Op[][] {
  const random = mulberry32(0x6502);
  const lists: Op[][] = [
    [
      { kind: "spawn", count: 2 },
      { kind: "destroy" },
      { kind: "create" },
    ],
    [
      { kind: "create" },
      { kind: "spawn", count: 2 },
      { kind: "destroy" },
      { kind: "create" },
    ],
  ];
  while (lists.length < 500) {
    const count = 1 + Math.floor(random() * 8);
    const ops: Op[] = [];
    for (let index = 0; index < count; index += 1) {
      const roll = random();
      if (roll < 0.35) ops.push({ kind: "create" });
      else if (roll < 0.55) ops.push({ kind: "destroy" });
      else if (roll < 0.8) ops.push({ kind: "spawn", count: Math.floor(random() * 4) });
      else ops.push({ kind: "wipe", count: 1 + Math.floor(random() * 3) });
    }
    lists.push(ops);
  }
  return lists;
}

describe("entity id parity", () => {
  it("deferred create, destroy, bulk spawn, and bulk destroy match the bridge ids", async () => {
    const outside = await createEngine({ maxEntities: 256 });
    const inside = await createEngine({ maxEntities: 256 });
    try {
      const outsideAnchor = outside.createEntity();
      outside.addComponent(outsideAnchor, Position, { x: 1, y: 0 });
      const outsideVictim = outside.createEntity();
      const insideAnchor = inside.createEntity();
      inside.addComponent(insideAnchor, Position, { x: 1, y: 0 });
      const insideVictim = inside.createEntity();
      const mismatches: string[] = [];
      let spawnAlive: boolean | null = null;
      let played = 0;

      for (const ops of sequences()) {
        const seeded = played === 0;
        const outsideRun = play(
          outside,
          false,
          ops,
          seeded
            ? [
                {
                  index: entityIndex(outsideVictim),
                  generation: entityGeneration(outsideVictim),
                  id: outsideVictim,
                  origin: "create",
                },
              ]
            : [],
        );
        const insideRun = play(
          inside,
          true,
          ops,
          seeded
            ? [
                {
                  index: entityIndex(insideVictim),
                  generation: entityGeneration(insideVictim),
                  id: insideVictim,
                  origin: "create",
                },
              ]
            : [],
        );
        if (insideRun.spawnAlive !== null) spawnAlive = insideRun.spawnAlive;
        const left = outsideRun.trace.join(" ");
        const right = insideRun.trace.join(" ");
        if (left !== right) {
          mismatches.push(`${played} outside ${left} inside ${right}`);
          break;
        }
        const gone = new Uint32Array(outsideRun.live.map((item) => item.index));
        bridgeOf(outside).bulkDestroy(gone);
        bridgeOf(inside).bulkDestroy(new Uint32Array(insideRun.live.map((item) => item.index)));
        played += 1;
      }

      expect(mismatches, mismatches[0] ?? "").toEqual([]);
      expect(played).toBe(500);
      expect(spawnAlive).toBe(false);
    } finally {
      await outside.stop();
      await inside.stop();
    }
  }, 60_000);
});
