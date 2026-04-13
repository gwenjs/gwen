import { describe, it, expect } from "vitest";
import { definePrefab, defineActor } from "../../src/actor/index";
import { createEngine } from "../../src/engine/gwen-engine";
import {
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
} from "../../src/system/defines/define-system";

const Hp = { __name__: "Hp" };
const TestPrefab = definePrefab([{ def: Hp, defaults: { value: 100 } }]);

describe("ActorInstance pool fields", () => {
  it("instance has _isDormant=false, _release=[], _reset=[] after spawn", async () => {
    const engine = await createEngine();
    const Actor = defineActor(TestPrefab, () => {});
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    const inst = Actor._instances.get(id)!;

    expect(inst._isDormant).toBe(false);
    expect(inst._release).toEqual([]);
    expect(inst._reset).toEqual([]);
  });
});

describe("dormant frame skip", () => {
  it("onUpdate is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onUpdate(spy);
    });
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    Actor._instances.get(id)!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("onBeforeUpdate is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onBeforeUpdate(spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("onAfterUpdate is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onAfterUpdate(spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("onRender is NOT called for dormant instances", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onRender(spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).not.toHaveBeenCalled();
  });

  it("callbacks resume when _isDormant is set back to false", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onUpdate(spy);
    });
    await engine.use(Actor._plugin);

    const inst = Actor._instances.get(Actor._plugin.spawn!())!;
    inst._isDormant = true;

    await engine.start();
    await engine.advance(16);
    expect(spy).not.toHaveBeenCalled();

    inst._isDormant = false;
    await engine.advance(16);
    await engine.stop();

    expect(spy).toHaveBeenCalledOnce();
  });

  it("non-dormant instances still receive callbacks", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onUpdate(spy);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn!();

    await engine.start();
    await engine.advance(16);
    await engine.stop();

    expect(spy).toHaveBeenCalled();
  });
});
