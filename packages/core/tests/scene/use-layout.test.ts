import { describe, it, expect } from 'vitest';
import { createEngine } from '../../src/engine/gwen-engine.js';
import { defineLayout } from '../../src/scene/define-layout.js';
import { useLayout } from '../../src/scene/use-layout.js';
import { definePrefab } from '../../src/scene/define-prefab.js';
import { defineActor } from '../../src/scene/define-actor.js';
import { placeActor, placeGroup } from '../../src/scene/place.js';

const Pos = { __name__: 'Position' };
const SimplePrefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);

describe('useLayout — lazy mode', () => {
  it('load() makes active true and provides refs', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    await engine.run(async () => {
      const Layout = defineLayout(() => {
        const a = placeActor(Actor, { at: [0, 0] });
        return { a };
      });
      const handle = useLayout(Layout, { lazy: true });
      expect(handle.active).toBe(false);
      await handle.load();
      expect(handle.active).toBe(true);
      expect(typeof handle.refs.a.entityId).toBe('bigint');
    });
  });

  it('dispose() makes active false', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    await engine.run(async () => {
      const Layout = defineLayout(() => ({ a: placeActor(Actor, {}) }));
      const handle = useLayout(Layout, { lazy: true });
      await handle.load();
      await handle.dispose();
      expect(handle.active).toBe(false);
    });
  });

  it('dispose() is idempotent — safe to call twice', async () => {
    const engine = await createEngine();
    await engine.run(async () => {
      const Layout = defineLayout(() => ({ g: placeGroup({ at: [0, 0] }) }));
      const handle = useLayout(Layout, { lazy: true });
      await handle.load();
      await handle.dispose();
      await expect(handle.dispose()).resolves.toBeUndefined();
    });
  });

  it('two instances of the same layout definition are independent', async () => {
    const engine = await createEngine();
    const Actor = defineActor(SimplePrefab, () => ({}));
    await engine.use(Actor._plugin);

    await engine.run(async () => {
      const Layout = defineLayout(() => ({ a: placeActor(Actor, {}) }));
      const h1 = useLayout(Layout, { lazy: true });
      const h2 = useLayout(Layout, { lazy: true });
      await h1.load();
      await h2.load();
      expect(h1.refs.a.entityId).not.toBe(h2.refs.a.entityId);
      await h1.dispose();
      expect(h2.active).toBe(true);
    });
  });
});
