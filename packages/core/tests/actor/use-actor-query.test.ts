import { stubComponent } from "../helpers/stub-component";
import { describe, it, expect } from "vitest";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";
import { useActorQuery } from "../../src/actor/runtime/use-actor-query";
import { createEngine } from "../../src/engine/gwen-engine";
import { createEntityId } from "../../src/types/entity";
import type { EntityId } from "../../src/engine/engine-api";

const Position = stubComponent("Position");
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

function makeQuery(...ids: EntityId[]): Array<{ readonly id: EntityId }> {
  return ids.map((id) => ({ id }));
}

describe("useActorQuery", () => {
  it("returns an empty iterable when the query is empty", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();

    const result = useActorQuery(Actor, makeQuery());
    expect(Array.from(result)).toHaveLength(0);
  });

  it("yields the API for an entity present in both the query and _instances", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 99 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();

    const result = useActorQuery(Actor, makeQuery(id));
    const apis = Array.from(result);
    expect(apis).toHaveLength(1);
    expect(apis[0]?.value).toBe(99);
  });

  it("skips an entity in the query that has no corresponding actor instance", () => {
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    const ghostId = createEntityId(999, 1);

    const result = useActorQuery(Actor, makeQuery(ghostId));
    expect(Array.from(result)).toHaveLength(0);
  });

  it("skips a live instance whose entity is not in the query", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();

    const result = useActorQuery(Actor, makeQuery());
    expect(Array.from(result)).toHaveLength(0);
  });

  it("filters correctly — only entities present in both query and instances are yielded", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const idA = handle.spawn();
    handle.spawn();

    // Only idA is in the query
    const result = useActorQuery(Actor, makeQuery(idA));
    expect(Array.from(result)).toHaveLength(1);
  });

  it("is lazy — re-evaluates on each for...of call", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const queryEntries: Array<{ readonly id: EntityId }> = [];
    const result = useActorQuery(Actor, queryEntries);

    expect(Array.from(result)).toHaveLength(0);

    const id = handle.spawn();
    queryEntries.push({ id });

    expect(Array.from(result)).toHaveLength(1);
  });

  it("reflects despawn between iterations", async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 1 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();
    const queryEntries: Array<{ readonly id: EntityId }> = [{ id }];
    const result = useActorQuery(Actor, queryEntries);

    expect(Array.from(result)).toHaveLength(1);

    handle.despawn(id);
    expect(Array.from(result)).toHaveLength(0);
  });
});
