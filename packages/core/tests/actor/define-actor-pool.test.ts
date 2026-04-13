import { describe, it, expect } from "vitest";
import { definePrefab, defineActor } from "../../src/actor/index";
import { createEngine } from "../../src/engine/gwen-engine";
import {
  onUpdate,
  onBeforeUpdate,
  onAfterUpdate,
  onRender,
} from "../../src/system/defines/define-system";
import { onEvent } from "../../src/actor/defines/define-actor";

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

describe("onEvent dormant guard", () => {
  it("event handler is NOT called when actor is dormant", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onEvent("engine:tick", spy);
    });
    await engine.use(Actor._plugin);

    Actor._instances.get(Actor._plugin.spawn!())!._isDormant = true;
    engine.hooks.callHook("engine:tick", 16);

    expect(spy).not.toHaveBeenCalled();
  });

  it("event handler IS called when actor is not dormant", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onEvent("engine:tick", spy);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn!();

    engine.hooks.callHook("engine:tick", 16);

    expect(spy).toHaveBeenCalledOnce();
  });

  it("event cleanup still works correctly after dormant/active cycle", async () => {
    const engine = await createEngine();
    const spy = vi.fn();
    const Actor = defineActor(TestPrefab, () => {
      onEvent("engine:tick", spy);
    });
    await engine.use(Actor._plugin);

    const id = Actor._plugin.spawn!();
    const inst = Actor._instances.get(id)!;

    // Mark dormant → event is silenced
    inst._isDormant = true;
    engine.hooks.callHook("engine:tick", 16);
    expect(spy).not.toHaveBeenCalled();

    // Mark active → event fires again
    inst._isDormant = false;
    engine.hooks.callHook("engine:tick", 16);
    expect(spy).toHaveBeenCalledOnce();

    // Despawn → handler removed, no more calls
    Actor._plugin.despawn!(id);
    engine.hooks.callHook("engine:tick", 16);
    expect(spy).toHaveBeenCalledOnce(); // still once
  });
});
