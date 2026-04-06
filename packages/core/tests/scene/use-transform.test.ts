import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createEngine } from '../../src/engine/gwen-engine.js';
import { definePrefab } from '../../src/scene/define-prefab.js';
import { defineActor } from '../../src/scene/define-actor.js';
import { useTransform } from '../../src/scene/use-transform.js';
import { defineLayout, placeActor, useLayout } from '../../src/scene/index.js';
import {
  getWasmBridge,
  _injectMockWasmEngine,
  _resetWasmBridge,
} from '../../src/engine/wasm-bridge.js';

// Helper to create a minimal mock WASM engine
function createMockEngine() {
  return {
    translate_entity: () => {},
    set_entity_local_position: () => {},
    set_entity_local_rotation: () => {},
    get_entity_local_rotation: () => 0,
    set_entity_local_scale: () => {},
    get_entity_world_x: () => 0,
    get_entity_world_y: () => 0,
    get_entity_world_rotation: () => 0,
    has_entity_parent: () => false,
    set_entity_parent: () => {},
  };
}

const Pos = { __name__: 'Position' };
const Prefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);

describe('useTransform context guard', () => {
  beforeEach(() => {
    _injectMockWasmEngine(createMockEngine() as any);
  });

  afterEach(() => {
    _resetWasmBridge();
  });

  it('throws with descriptive message when called outside defineActor', () => {
    expect(() => useTransform()).toThrow(/useTransform.*defineActor/);
  });
});

describe('useTransform — local write operations', () => {
  beforeEach(() => {
    _injectMockWasmEngine(createMockEngine() as any);
  });

  afterEach(() => {
    _resetWasmBridge();
  });

  it('translate() calls translate_entity on the bridge', async () => {
    const engine = await createEngine();
    const bridge = getWasmBridge().engine();
    // Ensure the method exists before spying
    if (!bridge.translate_entity) {
      bridge.translate_entity = () => {};
    }
    const spy = vi.spyOn(bridge, 'translate_entity').mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.translate(5, 10);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 5, 10);
  });

  it('setPosition() calls set_entity_local_position on the bridge', async () => {
    const engine = await createEngine();
    const bridge = getWasmBridge().engine();
    // Ensure the method exists before spying
    if (!bridge.set_entity_local_position) {
      bridge.set_entity_local_position = () => {};
    }
    const spy = vi.spyOn(bridge, 'set_entity_local_position').mockImplementation(() => {});

    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      t.setPosition(100, 200);
    });
    await engine.use(Actor._plugin);
    await engine.run(() => Actor._plugin.spawn());

    expect(spy).toHaveBeenCalledWith(expect.any(Number), 100, 200);
  });
});

describe('useTransform — setParent / detach', () => {
  beforeEach(() => {
    _injectMockWasmEngine(createMockEngine() as any);
  });

  afterEach(() => {
    _resetWasmBridge();
  });

  it('setParent() calls set_entity_parent with correct indices', async () => {
    const engine = await createEngine();
    const bridge = getWasmBridge().engine();
    // Ensure the method exists before spying
    if (!bridge.set_entity_parent) {
      bridge.set_entity_parent = () => {};
    }
    const spy = vi.spyOn(bridge, 'set_entity_parent').mockImplementation(() => {});

    let childEntityId: bigint | undefined;
    const Child = defineActor(Prefab, () => {
      const t = useTransform();
      return { setParentTo: (id: bigint) => t.setParent(id) };
    });
    await engine.use(Child._plugin);

    await engine.run(() => {
      childEntityId = Child._plugin.spawn() as unknown as bigint;
      Child._instances.get(childEntityId!)!.api.setParentTo(99n);
    });

    expect(spy).toHaveBeenCalledWith(
      Number(childEntityId!) & 0xffffffff,
      Number(99n) & 0xffffffff,
      false,
    );
  });

  it('detach() calls set_entity_parent with u32::MAX (0xffffffff) as parent index', async () => {
    const engine = await createEngine();
    const bridge = getWasmBridge().engine();
    // Ensure the method exists before spying
    if (!bridge.set_entity_parent) {
      bridge.set_entity_parent = () => {};
    }
    const spy = vi.spyOn(bridge, 'set_entity_parent').mockImplementation(() => {});

    let entityId: bigint | undefined;
    const Actor = defineActor(Prefab, () => {
      const t = useTransform();
      return { doDetach: () => t.detach() };
    });
    await engine.use(Actor._plugin);

    await engine.run(() => {
      entityId = Actor._plugin.spawn() as unknown as bigint;
      Actor._instances.get(entityId!)!.api.doDetach();
    });

    expect(spy).toHaveBeenCalledWith(Number(entityId!) & 0xffffffff, 0xffffffff, false);
  });
});

describe('useTransform — world reads', () => {
  beforeEach(() => {
    _injectMockWasmEngine(createMockEngine() as any);
  });

  afterEach(() => {
    _resetWasmBridge();
  });

  it('world reads return values from the bridge', async () => {
    const engine = await createEngine();

    let worldHandle: any;
    const SimplePrefab = definePrefab([{ def: Pos, defaults: { x: 0, y: 0 } }]);
    const Actor = defineActor(SimplePrefab, () => {
      worldHandle = useTransform();
      return {};
    });
    await engine.use(Actor._plugin);

    const TestLayout = defineLayout(() => {
      placeActor(Actor, { at: [10, 20] });
      return {};
    });

    await engine.run(async () => {
      const layout = useLayout(TestLayout, { lazy: true });
      await layout.load();
    });

    // world reads should return numbers (mock bridge returns 0 for undefined calls)
    expect(typeof worldHandle?.world.x).toBe('number');
    expect(typeof worldHandle?.world.y).toBe('number');
    expect(typeof worldHandle?.world.rotation).toBe('number');
  });
});
