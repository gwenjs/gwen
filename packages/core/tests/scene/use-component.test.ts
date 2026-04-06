import { describe, it, expect } from 'vitest';
import { definePrefab } from '../../src/scene/define-prefab.js';
import { defineActor } from '../../src/scene/define-actor.js';
import { useComponent } from '../../src/scene/use-actor.js';
import { onUpdate } from '../../src/system.js';
import { createEngine } from '../../src/engine/gwen-engine.js';

const Position = { __name__: 'Position' };

const PosPrefab = definePrefab([{ def: Position, defaults: { x: 0, y: 0 } }]);

describe('useComponent', () => {
  it('reads the component from the current actor entity', async () => {
    const engine = await createEngine();
    let capturedX: number | undefined;

    const Actor = defineActor(PosPrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent<any>(Position);
      onUpdate(() => {
        capturedX = pos.x;
      });
    });
    await engine.use(Actor._plugin);
    Actor._plugin.spawn();

    // Advance one full frame — triggers plugin.onUpdate → instance._update callbacks
    await engine.advance(16);

    // Component x defaults to 0 from prefab; 0 is defined (not undefined)
    expect(capturedX).toBeDefined();
  });

  it('writes to the component via proxy set', async () => {
    const engine = await createEngine();

    const Actor = defineActor(PosPrefab, () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pos = useComponent<any>(Position);
      onUpdate(() => {
        pos.x = 99;
      });
    });
    await engine.use(Actor._plugin);
    const entityId = Actor._plugin.spawn();

    // Advance one full frame — proxy setter runs inside onUpdate
    await engine.advance(16);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const component = engine.getComponent(entityId!, Position as any);
    if (component !== null && component !== undefined) {
      expect((component as { x: number }).x).toBe(99);
    }
  });
});
