import { stubValue } from "../helpers/stub-component";
import { describe, it, expect, vi } from "vitest";
import { createEngine } from "../../src/engine/gwen-engine";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { defineActor, onStart, onDestroy } from "../../src/actor/runtime/define-actor";
import { useChildren } from "../../src/actor/runtime/use-children";
import type { PlaceHandle } from "../../src/actor/runtime/types";
import { defineActorPool } from "../../src/actor/runtime/pool/define-actor-pool";
import {
  GwenComposableError,
  GwenActorError,
  ComposableErrorCodes,
  ActorErrorCodes,
} from "../../src/engine/engine-errors";

const Hp = stubValue("Hp");
const Prefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

// ─── Context guard ─────────────────────────────────────────────────────────────

describe("useChildren — context guard", () => {
  it("throws GwenComposableError with OUTSIDE_ACTOR_CONTEXT when called outside a factory", () => {
    expect(() => useChildren()).toThrow(GwenComposableError);
    expect(() => useChildren()).toThrow(ComposableErrorCodes.OUTSIDE_ACTOR_CONTEXT);
  });
});

// ─── Basic ownership ───────────────────────────────────────────────────────────

describe("useChildren — basic ownership", () => {
  it("add() spawns the child actor and returns a PlaceHandle", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    const Parent = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        const handle = children.add(Child);
        expect(handle).toBeDefined();
        expect(typeof handle.entityId).toBe("bigint");
        expect(typeof handle.despawn).toBe("function");
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    Parent._plugin.spawn();
    expect(Child._instances.size).toBe(1);
  });

  it("add() registers the child in all", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    let childrenHandle: ReturnType<typeof useChildren>;
    const Parent = defineActor(Prefab, () => {
      childrenHandle = useChildren();
      onStart(() => {
        childrenHandle.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    Parent._plugin.spawn();
    expect(childrenHandle!.all.size).toBe(1);
  });

  it("adopt() takes ownership of an existing handle", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    let childrenHandle: ReturnType<typeof useChildren>;
    const Parent = defineActor(Prefab, () => {
      childrenHandle = useChildren();
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    const childId = Child._plugin.spawn();
    const handle = { entityId: childId, api: undefined as void, moveTo: vi.fn(), despawn: vi.fn() };
    Parent._plugin.spawn();
    childrenHandle!.adopt(handle);
    expect(childrenHandle!.all.size).toBe(1);
  });

  it("detach() removes the child from all without destroying it", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    let childrenHandle: ReturnType<typeof useChildren>;
    let childHandle: PlaceHandle<void>;
    const Parent = defineActor(Prefab, () => {
      childrenHandle = useChildren();
      onStart(() => {
        childHandle = childrenHandle.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    Parent._plugin.spawn();

    childrenHandle!.detach(childHandle!);

    expect(childrenHandle!.all.size).toBe(0);
    expect(Child._instances.size).toBe(1); // still alive
  });

  it("all is a ReadonlySet — cannot be mutated from outside", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    let childrenHandle: ReturnType<typeof useChildren>;
    const Parent = defineActor(Prefab, () => {
      childrenHandle = useChildren();
      onStart(() => {
        childrenHandle.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    Parent._plugin.spawn();

    const all = childrenHandle!.all;
    // ReadonlySet: iterable with correct size, no mutation at type level
    expect(all.size).toBe(1);
    expect([...all]).toHaveLength(1);
  });
});

// ─── Despawn cascade ───────────────────────────────────────────────────────────

describe("useChildren — despawn cascade", () => {
  it("despawning the parent despawns non-pooled children", async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();
    const Child = defineActor(Prefab, () => {
      onDestroy(destroySpy);
    });
    const Parent = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        children.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    const parentId = Parent._plugin.spawn();
    expect(Child._instances.size).toBe(1);

    Parent._plugin.despawn(parentId);

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(Child._instances.size).toBe(0);
  });

  it("despawning the parent clears _children", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    const Parent = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        children.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    const parentId = Parent._plugin.spawn();
    const parentInst = Parent._instances.get(parentId)!;
    expect(parentInst._children!.size).toBe(1);

    Parent._plugin.despawn(parentId);

    expect(Child._instances.size).toBe(0);
  });

  it("despawn cascade is recursive (grandparent → parent → child)", async () => {
    const engine = await createEngine();
    const grandchildSpy = vi.fn();
    const Grandchild = defineActor(Prefab, () => {
      onDestroy(grandchildSpy);
    });
    const Child = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        children.add(Grandchild);
      });
    });
    const Parent = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        children.add(Child);
      });
    });
    await engine.use(Grandchild._plugin);
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    const parentId = Parent._plugin.spawn();

    Parent._plugin.despawn(parentId);

    expect(grandchildSpy).toHaveBeenCalledOnce();
    expect(Grandchild._instances.size).toBe(0);
    expect(Child._instances.size).toBe(0);
  });

  it("directly despawning a child removes it from parent._children (no dangling ref)", async () => {
    const engine = await createEngine();
    const Child = defineActor(Prefab, () => {});
    const Parent = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        children.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    const parentId = Parent._plugin.spawn();
    const childId = [...Child._instances.keys()][0]!;

    Child._plugin.despawn(childId);

    const parentInstance = Parent._instances.get(parentId)!;
    expect(parentInstance._children!.has(childId)).toBe(false);
  });

  it("detach() then despawn parent — detached child survives", async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();
    const Child = defineActor(Prefab, () => {
      onDestroy(destroySpy);
    });
    let childrenHandle: ReturnType<typeof useChildren>;
    let childHandle: PlaceHandle<void>;
    const Parent = defineActor(Prefab, () => {
      childrenHandle = useChildren();
      onStart(() => {
        childHandle = childrenHandle.add(Child);
      });
    });
    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    const parentId = Parent._plugin.spawn();

    childrenHandle!.detach(childHandle!);
    Parent._plugin.despawn(parentId);

    expect(destroySpy).not.toHaveBeenCalled();
    expect(Child._instances.size).toBe(1);
  });
});

// ─── Error cases ───────────────────────────────────────────────────────────────

describe("useChildren — error cases", () => {
  it("throws GwenActorError with CIRCULAR_OWNERSHIP when A owns B and B tries to own A", async () => {
    const engine = await createEngine();
    let childrenA: ReturnType<typeof useChildren>;
    let childrenB: ReturnType<typeof useChildren>;
    // oxlint-disable-next-line prefer-const
    let handleA: PlaceHandle<void>;

    const ActorB = defineActor(Prefab, () => {
      childrenB = useChildren();
    });
    const ActorA = defineActor(Prefab, () => {
      childrenA = useChildren();
      onStart(() => {
        childrenA.add(ActorB);
        // Now B tries to own A — should throw
        expect(() => childrenB!.adopt(handleA)).toThrow(GwenActorError);
        expect(() => childrenB!.adopt(handleA)).toThrow(ActorErrorCodes.CIRCULAR_OWNERSHIP);
      });
    });

    await engine.use(ActorB._plugin);
    await engine.use(ActorA._plugin);
    const aId = ActorA._plugin.spawn();
    handleA = {
      entityId: aId,
      api: undefined,
      moveTo: vi.fn(),
      despawn: vi.fn(),
    };
  });
});

// ─── Pool release cascade ──────────────────────────────────────────────────────

describe("useChildren — pool release cascade", () => {
  it("releasing a pooled parent releases a pooled child", async () => {
    const engine = await createEngine();
    const ChildActor = defineActor(Prefab, () => {});
    const ChildPool = defineActorPool(ChildActor, { size: 5 });
    let childrenHandle: ReturnType<typeof useChildren>;
    const Parent = defineActor(Prefab, () => {
      childrenHandle = useChildren();
    });
    const ParentPool = defineActorPool(Parent, { size: 5 });

    await engine.use(ChildActor._plugin);
    await engine.use(ChildPool._plugin);
    await engine.use(Parent._plugin);
    await engine.use(ParentPool._plugin);

    await engine.start();

    const parentId = ParentPool.acquire();
    const childId = ChildPool.acquire();
    const handle = { entityId: childId, api: undefined as void, moveTo: vi.fn(), despawn: vi.fn() };
    childrenHandle!.adopt(handle);

    expect(ParentPool.stats().active).toBe(1);
    expect(ChildPool.stats().active).toBe(1);

    ParentPool.release(parentId);

    await engine.advance(0.016); // flush deferred releases

    expect(ParentPool.stats().active).toBe(0);
    expect(ChildPool.stats().active).toBe(0);
    expect(ChildPool.stats().available).toBe(1); // released, not destroyed

    await engine.stop();
  });

  it("releasing a pooled parent despawns a non-pooled child", async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();
    const Child = defineActor(Prefab, () => {
      onDestroy(destroySpy);
    });
    const Parent = defineActor(Prefab, () => {
      const children = useChildren();
      onStart(() => {
        children.add(Child);
      });
    });
    const ParentPool = defineActorPool(Parent, { size: 5 });

    await engine.use(Child._plugin);
    await engine.use(Parent._plugin);
    await engine.use(ParentPool._plugin);

    await engine.start();

    const parentId = ParentPool.acquire();
    expect(Child._instances.size).toBe(1);

    ParentPool.release(parentId);
    await engine.advance(0.016); // flush deferred releases

    expect(destroySpy).toHaveBeenCalledOnce();
    expect(Child._instances.size).toBe(0);

    await engine.stop();
  });
});
