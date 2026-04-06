import { describe, it, expect } from 'vitest';
import { definePrefab } from '../../src/scene/define-prefab.js';
import { defineActor } from '../../src/scene/define-actor.js';
import { useActor, usePrefab } from '../../src/scene/use-actor.js';
import { createEngine } from '../../src/engine/gwen-engine.js';

const Position = { __name__: 'Position' };

const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe('useActor', () => {
  it('spawn delegates to _plugin.spawn', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ greet: () => 'hi' }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();
    expect(Actor._instances.has(id)).toBe(true);
  });

  it('despawn delegates to _plugin.despawn', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id = handle.spawn();
    handle.despawn(id);
    expect(Actor._instances.has(id)).toBe(false);
  });

  it('count returns number of live instances', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    expect(handle.count()).toBe(0);
    handle.spawn();
    handle.spawn();
    expect(handle.count()).toBe(2);
  });

  it('get returns first live instance api', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 42 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    expect(handle.get()).toBeUndefined();
    handle.spawn();
    expect(handle.get()?.value).toBe(42);
  });

  it('getAll returns all live instance apis', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ value: 42 }));
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();
    handle.spawn();
    expect(handle.getAll()).toHaveLength(2);
  });

  it('despawnAll removes all instances', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    handle.spawn();
    handle.spawn();
    handle.despawnAll();
    expect(handle.count()).toBe(0);
  });

  it('spawnOnce spawns only one instance on repeated calls', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const handle = engine.run(() => useActor(Actor));
    const id1 = handle.spawnOnce();
    const id2 = handle.spawnOnce();
    expect(id1).toBe(id2);
    expect(handle.count()).toBe(1);
  });
});

describe('usePrefab', () => {
  it('spawn creates an entity and adds prefab components', async () => {
    const engine = await createEngine();
    const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const { spawn, despawn } = engine.run(() => usePrefab(Prefab));
    const id = spawn();
    expect(engine.isAlive(id)).toBe(true);

    despawn(id);
    expect(engine.isAlive(id)).toBe(false);
  });

  it('spawn accepts component overrides', async () => {
    const engine = await createEngine();
    const Prefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

    const { spawn } = engine.run(() => usePrefab(Prefab));
    const id = spawn({ x: 99 });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pos = engine.getComponent(id, Position as any);
    expect(pos?.x).toBe(99);
  });
});
