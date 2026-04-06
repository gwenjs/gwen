import { describe, it, expect, vi } from 'vitest';
import { definePrefab } from '../../src/scene/define-prefab.js';
import { defineActor, onStart, onDestroy, onEvent } from '../../src/scene/define-actor.js';
import { onUpdate } from '../../src/system.js';
import { createEngine } from '../../src/engine/gwen-engine.js';

// Minimal component defs
const Position = { __name__: 'Position' };

const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe('defineActor', () => {
  it('returns an ActorDefinition with _plugin, _instances, _prefab', () => {
    const Actor = defineActor(SimplePrefab, () => {});
    expect(typeof Actor._plugin).toBe('object');
    expect(Actor._instances).toBeInstanceOf(Map);
    expect(Actor._prefab).toBe(SimplePrefab);
    expect(Actor.__actorName__).toBe('anonymous');
  });

  it('starts with zero instances', () => {
    const Actor = defineActor(SimplePrefab, () => {});
    expect(Actor._instances.size).toBe(0);
  });
});

describe('defineActor spawn/despawn', () => {
  it('spawn creates an entity and registers instance', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const entityId = Actor._plugin.spawn?.();
    expect(typeof entityId).toBe('bigint');
    expect(Actor._instances.has(entityId!)).toBe(true);
  });

  it('despawn removes the instance and destroys the entity', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {});
    await engine.use(Actor._plugin);

    const entityId = Actor._plugin.spawn?.();
    Actor._plugin.despawn?.(entityId!);
    expect(Actor._instances.has(entityId!)).toBe(false);
  });
});

describe('lifecycle hooks inside factory', () => {
  it('onStart is called once after spawn', async () => {
    const engine = await createEngine();
    const startSpy = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onStart(startSpy);
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn?.();
    expect(startSpy).toHaveBeenCalledOnce();
  });

  it('onDestroy is called on despawn', async () => {
    const engine = await createEngine();
    const destroySpy = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onDestroy(destroySpy);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();
    Actor._plugin.despawn?.(id!);
    expect(destroySpy).toHaveBeenCalledOnce();
  });

  it('onUpdate callback is collected from factory', async () => {
    const engine = await createEngine();
    const updateSpy = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onUpdate(updateSpy);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();
    const instance = Actor._instances.get(id!);
    expect(instance?._update).toHaveLength(1);
  });

  it('onEvent registers and cleans up on despawn', async () => {
    const engine = await createEngine();
    const handler = vi.fn();
    const Actor = defineActor(SimplePrefab, () => {
      onEvent('entity:create' as never, handler as never);
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();

    // handler registered — calling hook should invoke it
    engine.hooks.callHook('entity:create' as never, 0n as never);
    expect(handler).toHaveBeenCalledOnce();

    // after despawn — cleanup should have removed the handler
    Actor._plugin.despawn?.(id!);
    engine.hooks.callHook('entity:create' as never, 1n as never);
    expect(handler).toHaveBeenCalledOnce(); // still 1 — not called again
  });
});

describe('public API', () => {
  it('factory return value becomes instance.api', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => {
      return { greet: () => 'hello' };
    });
    await engine.use(Actor._plugin);
    const id = Actor._plugin.spawn?.();
    const instance = Actor._instances.get(id!);
    expect(instance?.api?.greet()).toBe('hello');
  });
});
