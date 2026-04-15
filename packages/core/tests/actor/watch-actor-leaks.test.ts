/**
 * Tests for watchActorLeaks — dev-time actor instance leak detector.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { watchActorLeaks } from "../../src/actor/uses/watch-actor-leaks";
import type { ActorDefinition } from "../../src/actor/types";
import type { EntityId } from "../../src/engine/engine-api";
import { createEngine } from "../../src/engine/gwen-engine";
import { definePrefab } from "../../src/actor/defines/define-prefab";
import { defineActor } from "../../src/actor/defines/define-actor";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeActorDef(name: string, initialCount = 0): ActorDefinition<void, void> {
  const _instances = new Map<EntityId, never>();
  for (let i = 0; i < initialCount; i++) {
    _instances.set(BigInt(i) as unknown as EntityId, undefined as never);
  }
  return {
    __actorName__: name,
    _instances,
    _plugin: {} as never,
    _prefab: {} as never,
    __props__: undefined as never,
    __api__: undefined as never,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("watchActorLeaks", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not fire onLeak when count is stable", () => {
    const onLeak = vi.fn();
    const def = makeActorDef("StableActor", 5);

    const stop = watchActorLeaks([def], { intervalMs: 1_000, growthStreak: 2, onLeak });
    vi.advanceTimersByTime(5_000);
    stop();

    expect(onLeak).not.toHaveBeenCalled();
  });

  it("does not fire onLeak on first growth interval (streak not reached)", () => {
    const onLeak = vi.fn();
    const def = makeActorDef("GrowingActor", 0);

    const stop = watchActorLeaks([def], { intervalMs: 1_000, growthStreak: 3, onLeak });

    // Grow once — streak = 1, threshold = 3 → no warning yet
    def._instances.set(BigInt(1) as unknown as EntityId, undefined as never);
    vi.advanceTimersByTime(1_000);

    expect(onLeak).not.toHaveBeenCalled();
    stop();
  });

  it("fires onLeak after growthStreak consecutive increases", () => {
    const onLeak = vi.fn();
    const def = makeActorDef("LeakingActor", 0);

    const stop = watchActorLeaks([def], { intervalMs: 1_000, growthStreak: 3, onLeak });

    for (let tick = 1; tick <= 3; tick++) {
      def._instances.set(BigInt(tick) as unknown as EntityId, undefined as never);
      vi.advanceTimersByTime(1_000);
    }

    expect(onLeak).toHaveBeenCalledOnce();
    expect(onLeak).toHaveBeenCalledWith("LeakingActor", 3, 1);
    stop();
  });

  it("resets streak when count stops growing", () => {
    const onLeak = vi.fn();
    const def = makeActorDef("TransientActor", 0);

    const stop = watchActorLeaks([def], { intervalMs: 1_000, growthStreak: 3, onLeak });

    // Grow twice (streak = 2)
    def._instances.set(BigInt(1) as unknown as EntityId, undefined as never);
    vi.advanceTimersByTime(1_000);
    def._instances.set(BigInt(2) as unknown as EntityId, undefined as never);
    vi.advanceTimersByTime(1_000);

    // Decrease (despawn) — streak resets
    def._instances.delete(BigInt(1) as unknown as EntityId);
    def._instances.delete(BigInt(2) as unknown as EntityId);
    vi.advanceTimersByTime(1_000);

    // Grow again — streak restarts from 0
    def._instances.set(BigInt(3) as unknown as EntityId, undefined as never);
    vi.advanceTimersByTime(1_000);
    def._instances.set(BigInt(4) as unknown as EntityId, undefined as never);
    vi.advanceTimersByTime(1_000);

    // Still below threshold (streak = 2 again)
    expect(onLeak).not.toHaveBeenCalled();
    stop();
  });

  it("monitors multiple actor defs independently", () => {
    const onLeak = vi.fn();
    const defA = makeActorDef("ActorA", 0);
    const defB = makeActorDef("ActorB", 0);

    const stop = watchActorLeaks([defA, defB], { intervalMs: 1_000, growthStreak: 2, onLeak });

    // Only ActorA grows
    for (let tick = 1; tick <= 2; tick++) {
      defA._instances.set(BigInt(tick) as unknown as EntityId, undefined as never);
      vi.advanceTimersByTime(1_000);
    }

    expect(onLeak).toHaveBeenCalledOnce();
    expect(onLeak.mock.calls[0]![0]).toBe("ActorA");
    stop();
  });

  it("stop() cancels monitoring", () => {
    const onLeak = vi.fn();
    const def = makeActorDef("CancelledActor", 0);

    const stop = watchActorLeaks([def], { intervalMs: 1_000, growthStreak: 2, onLeak });
    stop();

    // Grow after stopping — should not trigger
    def._instances.set(BigInt(1) as unknown as EntityId, undefined as never);
    vi.advanceTimersByTime(5_000);

    expect(onLeak).not.toHaveBeenCalled();
  });

  it("uses default onLeak (console.warn) when not provided", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const def = makeActorDef("DefaultWarnActor", 0);

    const stop = watchActorLeaks([def], { intervalMs: 1_000, growthStreak: 2 });

    for (let tick = 1; tick <= 2; tick++) {
      def._instances.set(BigInt(tick) as unknown as EntityId, undefined as never);
      vi.advanceTimersByTime(1_000);
    }

    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]![0]).toContain("DefaultWarnActor");
    expect(warn.mock.calls[0]![0]).toContain("despawnAll");

    stop();
    warn.mockRestore();
  });
});

describe("watchActorLeaks — hook-based mode", () => {
  it("detects a leak via engine afterTick instead of setInterval", async () => {
    const engine = await createEngine();
    const Position = { __name__: "Position" };
    const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);
    const Actor = defineActor(prefab, () => {});
    await engine.use(Actor._plugin);

    const leaks: string[] = [];
    const stop = watchActorLeaks([Actor], {
      engine,
      growthStreak: 2,
      onLeak: (name) => leaks.push(name),
    });

    // Spawn one per tick — 3 ticks ensures streak ≥ 2.
    Actor._plugin.spawn();
    await engine.advance(0.016);
    Actor._plugin.spawn();
    await engine.advance(0.016);
    Actor._plugin.spawn();
    await engine.advance(0.016);

    expect(leaks).toContain(Actor.__actorName__);

    stop();
    await engine.stop();
  });

  it("stop() unregisters the afterTick handler", async () => {
    const engine = await createEngine();
    const Position = { __name__: "Position" };
    const prefab = definePrefab([{ def: Position, defaults: { x: 0 } }]);
    const Actor = defineActor(prefab, () => {});
    await engine.use(Actor._plugin);

    const onLeak = vi.fn();
    const stop = watchActorLeaks([Actor], { engine, growthStreak: 1, onLeak });

    stop(); // stop before any frames
    Actor._plugin.spawn();
    await engine.advance(0.016);
    Actor._plugin.spawn();
    await engine.advance(0.016);

    expect(onLeak).not.toHaveBeenCalled();
    await engine.stop();
  });
});
