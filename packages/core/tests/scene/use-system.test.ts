import { describe, it, expect, vi } from "vitest";
import { defineScene } from "../../src/scene/defines/define-scene";
import { useSystem } from "../../src/scene/scene-context.js";
import { GwenContextError } from "../../src/engine/context";
import { createEngine } from "../../src/engine/gwen-engine.js";
import { defineSystem, onUpdate } from "../../src/system/defines/define-system";
import { defineActor } from "../../src/actor/defines/define-actor";
import { useActor } from "../../src/actor/uses/use-actor";
import { definePrefab } from "../../src/actor/defines/define-prefab";
import type { SystemHandle } from "../../src/scene/system-handle";
import type { GwenPlugin } from "../../src/engine/gwen-engine.js";

const Position = { __name__: "Position" };
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

function makePlugin(name: string): GwenPlugin {
  return { name, setup() {} };
}

describe("useSystem — basic API", () => {
  it("returns a SystemHandle", async () => {
    const engine = await createEngine();
    let handle!: SystemHandle;

    const MyScene = defineScene("Test", () => {
      handle = useSystem(makePlugin("A"));
    });

    await engine.run(() => MyScene({ register: () => {} }));
    expect(typeof handle.pause).toBe("function");
    expect(typeof handle.resume).toBe("function");
    expect(typeof handle.destroy).toBe("function");
  });

  it("throws GwenContextError outside a scene factory", () => {
    expect(() => useSystem(makePlugin("X"))).toThrow(GwenContextError);
  });

  it("registers the wrapped plugin in the scene definition's systems", async () => {
    const engine = await createEngine();
    const MyScene = defineScene("Test", () => {
      useSystem(makePlugin("SysA"));
    });

    let def!: ReturnType<typeof MyScene>;
    await engine.run(() => {
      def = MyScene({ register: () => {} });
    });

    expect(def.systems).toHaveLength(1);
    expect(def.systems[0]!.name).toBe("SysA");
  });

  it("multiple useSystem calls register independent plugins in order", async () => {
    const engine = await createEngine();
    const MyScene = defineScene("Test", () => {
      useSystem(makePlugin("Sys1"));
      useSystem(makePlugin("Sys2"));
      useSystem(makePlugin("Sys3"));
    });

    let def!: ReturnType<typeof MyScene>;
    await engine.run(() => {
      def = MyScene({ register: () => {} });
    });
    expect(def.systems.map((s) => s.name)).toEqual(["Sys1", "Sys2", "Sys3"]);
  });
});

describe("useSystem — collect pass (auto-install actor deps)", () => {
  it("actor used inside defineSystem is auto-registered to scene systems", async () => {
    const engine = await createEngine();
    const AsteroidActor = defineActor(SimplePrefab, () => {});
    const SpawnSystem = defineSystem("Spawn", () => {
      useActor(AsteroidActor); // actor dep inside system
    });

    const MyScene = defineScene("Test", () => {
      useSystem(SpawnSystem());
    });

    let def!: ReturnType<typeof MyScene>;
    await engine.run(() => {
      def = MyScene({ register: () => {} });
    });

    const names = def.systems.map((s) => s.name);
    // AsteroidActor._plugin must appear BEFORE SpawnSystem
    const actorIdx = names.indexOf(AsteroidActor._plugin.name);
    const systemIdx = names.findIndex((n) => n === "Spawn");
    expect(actorIdx).toBeGreaterThanOrEqual(0);
    expect(actorIdx).toBeLessThan(systemIdx);
  });

  it("actor used in both scene factory and system is not duplicated", async () => {
    const engine = await createEngine();
    const EnemyActor = defineActor(SimplePrefab, () => {});
    const EnemySystem = defineSystem("EnemySys", () => {
      useActor(EnemyActor);
    });

    const MyScene = defineScene("Test", () => {
      useActor(EnemyActor); // direct scene declaration
      useSystem(EnemySystem()); // system also uses it via collect pass
    });

    let def!: ReturnType<typeof MyScene>;
    await engine.run(() => {
      def = MyScene({ register: () => {} });
    });

    const actorPluginCount = def.systems.filter((s) => s.name === EnemyActor._plugin.name).length;
    expect(actorPluginCount).toBe(1);
  });

  it("system with DI dep does not cause collect pass errors", async () => {
    const engine = await createEngine();
    const PlayerActor = defineActor(SimplePrefab, () => {
      return { heal: () => {} };
    });

    const HealSystem = defineSystem((player: { heal(): void }) => {
      onUpdate(() => player.heal());
    });

    const MyScene = defineScene("Test", () => {
      const player = useActor(PlayerActor);
      expect(() => useSystem(HealSystem(player))).not.toThrow();
    });

    await engine.run(() => MyScene({ register: () => {} }));
  });
});

describe("useSystem — SystemHandle gating within scene", () => {
  it("paused system's onUpdate does not fire", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    let handle!: SystemHandle;

    const Sys = defineSystem("PauseTest", () => {
      onUpdate(spy);
    });

    const MyScene = defineScene("Test", () => {
      handle = useSystem(Sys());
    });

    await engine.run(() => MyScene({ register: () => {} }));
    await engine.use(MyScene({ register: () => {} }).systems[0]!);

    handle.pause();
    await engine.advance(16);
    expect(spy).not.toHaveBeenCalled();
  });
});
