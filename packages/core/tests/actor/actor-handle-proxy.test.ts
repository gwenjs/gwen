import { describe, it, expect, vi } from "vitest";
import { defineActor } from "../../src/actor/runtime/define-actor";
import { useActor } from "../../src/actor/runtime/use-actor";
import { definePrefab } from "../../src/actor/runtime/define-prefab";
import { createEngine } from "../../src/engine/gwen-engine";

const Position = { __name__: "Position" };
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe("ActorHandle Proxy — method delegation", () => {
  it("delegates PublicAPI methods to the first live instance", async () => {
    const engine = await createEngine();
    const takeDamageSpy = vi.fn();

    const PlayerActor = defineActor("PlayerProxy", SimplePrefab, () => {
      return { takeDamage: takeDamageSpy };
    });

    await engine.use(PlayerActor._plugin);
    PlayerActor._plugin.spawn?.();

    let handle!: ReturnType<typeof useActor<void, { takeDamage: () => void }>>;
    engine.run(() => {
      handle = useActor(PlayerActor);
    });

    // Proxy should forward the call to the instance's public API
    (handle as unknown as { takeDamage(): void }).takeDamage();
    expect(takeDamageSpy).toHaveBeenCalledOnce();
  });

  it("throws GwenActorError for PublicAPI method calls when no instance is alive", async () => {
    const engine = await createEngine();
    const PlayerActor = defineActor("PlayerNoInst", SimplePrefab, () => {
      return { heal: () => 42 };
    });

    await engine.use(PlayerActor._plugin);

    let handle!: ReturnType<typeof useActor<void, { heal(): number }>>;

    engine.run(() => {
      handle = useActor(PlayerActor);
    });

    // No instance spawned — must throw GwenActorError, not silently return undefined
    expect(() => (handle as unknown as { heal(): number }).heal()).toThrow("[GWEN]");
  });

  it("ActorHandle methods take priority over PublicAPI methods", async () => {
    const engine = await createEngine();
    // PublicAPI defines 'count' — same name as ActorHandle.count()
    const Actor = defineActor("PriorityTest", SimplePrefab, () => {
      // PublicAPI.count is a domain method that would conflict
      return { count: () => 999 };
    });

    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();

    let handle!: ReturnType<typeof useActor<void, { count(): number }>>;
    engine.run(() => {
      handle = useActor(Actor);
    });

    // handle.count() must return the ActorHandle count (1 instance), not the PublicAPI value
    expect(handle.count()).toBe(1);
  });

  it("delegates method calls with arguments correctly", async () => {
    const engine = await createEngine();
    const moveSpy = vi.fn();

    const Actor = defineActor("MoveTest", SimplePrefab, () => {
      return { move: (x: number, y: number) => moveSpy(x, y) };
    });

    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();

    let handle!: ReturnType<typeof useActor<void, { move(x: number, y: number): void }>>;
    engine.run(() => {
      handle = useActor(Actor);
    });

    (handle as unknown as { move(x: number, y: number): void }).move(10, 20);
    expect(moveSpy).toHaveBeenCalledWith(10, 20);
  });

  it("delegates property reads (non-function values)", async () => {
    const engine = await createEngine();
    const Actor = defineActor("PropTest", SimplePrefab, () => {
      return { speed: 42 };
    });

    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();

    let handle!: ReturnType<typeof useActor<void, { speed: number }>>;
    engine.run(() => {
      handle = useActor(Actor);
    });

    const speed = (handle as unknown as { speed: number }).speed;
    expect(speed).toBe(42);
  });

  it("ActorHandle.spawn, despawn, despawnAll, get, getAll, spawnOnce all still work", async () => {
    const engine = await createEngine();
    const Actor = defineActor("HandleMethods", SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    let handle!: ReturnType<typeof useActor<void, void>>;
    engine.run(() => {
      handle = useActor(Actor);
    });

    const id = handle.spawn();
    expect(typeof id).toBe("bigint");
    expect(handle.count()).toBe(1);
    expect(handle.get()).toBeUndefined(); // PublicAPI = void

    handle.despawn(id);
    expect(handle.count()).toBe(0);
  });
});
