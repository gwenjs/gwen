/**
 * watchActorLeaks with two real engines (#59, P-59-1).
 * The count belongs to the engine current at the call.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { defineComponent, Types } from "@gwenjs/core";
import {
  defineActor,
  definePrefab,
  watchActorLeaks,
  type ActorDefinition,
} from "@gwenjs/core/actor";
import { createRealEngine, type RealEngineHandle } from "@gwenjs/core/testing";

const Position = defineComponent({
  name: "LeakWatcherPosition",
  schema: { x: Types.f32, y: Types.f32 },
});

const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

const INTERVAL_MS = 1_000;
const GROWTH_STREAK = 2;
/** Other engine's live count. It must differ from the watched engine's leak count. */
const OTHER_COUNT = 5;

type LeakReport = {
  readonly name: string;
  readonly count: number;
  readonly delta: number;
};

const handles: RealEngineHandle[] = [];
const stops: Array<() => void> = [];

async function openEngine(): Promise<RealEngineHandle> {
  const handle = await createRealEngine({ variant: "light", maxEntities: 32 });
  handles.push(handle);
  return handle;
}

function spawnOn<API>(
  engine: RealEngineHandle["engine"],
  actor: ActorDefinition<void, API>,
  count: number,
): void {
  engine.run(() => {
    for (let index = 0; index < count; index += 1) {
      actor._plugin.spawn();
    }
  });
}

function watch(actorDefs: Parameters<typeof watchActorLeaks>[0], leaks: LeakReport[]): () => void {
  return watchActorLeaks(actorDefs, {
    intervalMs: INTERVAL_MS,
    growthStreak: GROWTH_STREAK,
    onLeak: (name, count, delta) => {
      leaks.push({ name, count, delta });
    },
  });
}

describe("watchActorLeaks with two engines", () => {
  afterEach(async () => {
    for (const stop of stops.splice(0)) {
      stop();
    }
    vi.useRealTimers();
    for (const handle of handles.splice(0)) {
      await handle.dispose();
    }
  });

  it("counts the engine current at the call", async () => {
    const engineA = (await openEngine()).engine;
    const engineB = (await openEngine()).engine;
    const actor = defineActor("LeakCurrentActor", Prefab, () => {});
    await engineA.use(actor._plugin);
    await engineB.use(actor._plugin);
    spawnOn(engineB, actor, OTHER_COUNT);

    vi.useFakeTimers();
    const leaks: LeakReport[] = [];
    stops.push(engineA.run(() => watch([actor], leaks)));

    for (let tick = 0; tick < GROWTH_STREAK; tick += 1) {
      spawnOn(engineA, actor, 1);
      vi.advanceTimersByTime(INTERVAL_MS);
    }

    expect(leaks).toEqual([{ name: actor.__actorName__, count: GROWTH_STREAK, delta: 1 }]);
  });

  it("an unbound watcher skips an actor installed by a second engine and keeps reporting the others", async () => {
    const engineA = (await openEngine()).engine;
    const engineB = (await openEngine()).engine;
    const actorX = defineActor("LeakSkipX", Prefab, () => {});
    const actorY = defineActor("LeakSkipY", Prefab, () => {});
    await engineA.use(actorX._plugin);
    await engineA.use(actorY._plugin);

    vi.useFakeTimers();
    const leaks: LeakReport[] = [];
    // X is first: a throw while reading X must not hide Y's report.
    stops.push(watch([actorX, actorY], leaks));
    await engineB.use(actorX._plugin);

    for (let tick = 0; tick < GROWTH_STREAK; tick += 1) {
      spawnOn(engineA, actorX, 1);
      spawnOn(engineA, actorY, 1);
      vi.advanceTimersByTime(INTERVAL_MS);
    }

    expect(leaks).toEqual([{ name: actorY.__actorName__, count: GROWTH_STREAK, delta: 1 }]);
  });

  it("zero instances on the engine current at the call stay unreported after stop()", async () => {
    const engineA = (await openEngine()).engine;
    const engineB = (await openEngine()).engine;
    const actor = defineActor("LeakEmptyActor", Prefab, () => {});
    await engineA.use(actor._plugin);
    await engineB.use(actor._plugin);
    spawnOn(engineB, actor, OTHER_COUNT);

    vi.useFakeTimers();
    const leaks: LeakReport[] = [];
    const stop = engineA.run(() => watch([actor], leaks));
    stops.push(stop);
    stop();

    for (let tick = 0; tick < GROWTH_STREAK; tick += 1) {
      spawnOn(engineA, actor, 1);
      vi.advanceTimersByTime(INTERVAL_MS);
    }

    expect(leaks).toEqual([]);
  });
});
