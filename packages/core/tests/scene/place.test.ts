/**
 * @file Tests for place.ts — layout placement composables.
 *
 * Tests the layout context guard (_withLayoutContext, _isInLayoutContext)
 * and the three placement composables (placeGroup, placeActor, placePrefab).
 */

import { describe, it, expect } from 'vitest';
import { definePrefab } from '../../src/scene/define-prefab.js';
import { defineActor } from '../../src/scene/define-actor.js';
import { createEngine } from '../../src/engine/gwen-engine.js';
import {
  _withLayoutContext,
  _isInLayoutContext,
  placeGroup,
  placeActor,
  placePrefab,
} from '../../src/scene/place.js';

const Position = { __name__: 'Position' };
const SimplePrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe('layout context guard', () => {
  it('_isInLayoutContext returns false outside a layout', () => {
    expect(_isInLayoutContext()).toBe(false);
  });

  it('_isInLayoutContext returns true inside _withLayoutContext', () => {
    let inside = false;
    _withLayoutContext(() => {
      inside = _isInLayoutContext();
    });
    expect(inside).toBe(true);
  });

  it('placeGroup throws when called outside a layout context', () => {
    expect(() => placeGroup({ at: [0, 0] })).toThrow(/placeGroup.*defineLayout/);
  });

  it('placeActor throws when called outside a layout context', () => {
    const Actor = defineActor(SimplePrefab, () => {});
    expect(() => placeActor(Actor, { at: [0, 0] })).toThrow(/placeActor.*defineLayout/);
  });

  it('placePrefab throws when called outside a layout context', () => {
    expect(() => placePrefab(SimplePrefab, { at: [0, 0] })).toThrow(/placePrefab.*defineLayout/);
  });
});

describe('placeGroup', () => {
  it('returns a PlaceHandle with a valid entityId inside layout context', async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [10, 20] });
      });
    });

    expect(typeof handle!.entityId).toBe('bigint');
    expect(handle!.api).toBeUndefined();
  });

  it('places entity at specified position', async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [5, 10] });
      });
    });

    expect(handle).toBeDefined();
    expect(typeof handle!.entityId).toBe('bigint');
  });
});

describe('placeActor', () => {
  it('spawns an actor entity and returns a PlaceHandle with api', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({ greet: () => 'hello' }));
    await engine.use(Actor._plugin);
    let handle: ReturnType<typeof placeActor<typeof Actor>> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeActor(Actor, { at: [5, 10] });
      });
    });

    expect(typeof handle!.entityId).toBe('bigint');
    expect(handle!.api.greet()).toBe('hello');
  });

  it('tracks spawned actor in instances', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);
    let handle: ReturnType<typeof placeActor> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeActor(Actor, { at: [0, 0] });
      });
    });

    expect(Actor._instances.has(handle!.entityId)).toBe(true);
  });
});

describe('placePrefab', () => {
  it('creates an entity with prefab components', async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placePrefab> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placePrefab(SimplePrefab, { at: [0, 0] });
      });
    });

    expect(typeof handle!.entityId).toBe('bigint');
    expect(handle!.api).toBeUndefined();
  });
});

describe('PlaceHandle methods', () => {
  it('moveTo updates entity position', async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [0, 0] });
      });
    });

    // Should not throw
    expect(() => handle!.moveTo([10, 20])).not.toThrow();
    expect(() => handle!.moveTo([10, 20, 30])).not.toThrow();
  });

  it('despawn removes entity', async () => {
    const engine = await createEngine();
    let handle: ReturnType<typeof placeGroup> | undefined;

    await engine.run(async () => {
      _withLayoutContext(() => {
        handle = placeGroup({ at: [0, 0] });
      });
    });

    // Should not throw
    expect(() => handle!.despawn()).not.toThrow();
  });
});

describe('_withLayoutContext captures entities', () => {
  it('returns entities list from context', async () => {
    const engine = await createEngine();
    let result: ReturnType<typeof _withLayoutContext> | undefined;

    await engine.run(async () => {
      result = _withLayoutContext(() => {
        placeGroup({ at: [0, 0] });
        placeGroup({ at: [10, 10] });
      });
    });

    expect(result!.entities).toHaveLength(2);
    expect(result!.entities.every((e) => typeof e === 'bigint')).toBe(true);
  });

  it('returns result from factory', () => {
    const result = _withLayoutContext(() => ({ foo: 'bar' }));

    expect(result.result).toEqual({ foo: 'bar' });
  });

  it('restores previous context after execution', () => {
    expect(_isInLayoutContext()).toBe(false);
    _withLayoutContext(() => {
      expect(_isInLayoutContext()).toBe(true);
    });
    expect(_isInLayoutContext()).toBe(false);
  });
});
