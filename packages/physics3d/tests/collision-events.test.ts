/**
 * Tests for Physics3D collision event parsing, hook dispatch, sensor state
 * updates, and per-entity callbacks.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock WASM bridge ────────────────────────────────────────────────────────

const physics3dInit = vi.fn();
const physics3dStep = vi.fn();
const physics3dAddBody = vi.fn(() => true);
const physics3dRemoveBody = vi.fn(() => true);

// Simulated event ring buffer
let mockEventCount = 0;
let mockEventsPtr = 0;
let mockMemoryBuffer: ArrayBuffer | null = null;

const physics3dGetCollisionEventsPtr = vi.fn(() => mockEventsPtr);
const physics3dGetCollisionEventCount = vi.fn(() => mockEventCount);
const physics3dConsumeEvents = vi.fn();
const physics3dGetBodyState = vi.fn((_idx: number) => new Float32Array(13));
const physics3dSetBodyState = vi.fn(() => true);
const physics3dGetLinearVelocity = vi.fn((_idx: number) => new Float32Array(3));
const physics3dGetAngularVelocity = vi.fn((_idx: number) => new Float32Array(3));
const physics3dGetBodyKind = vi.fn(() => 1);
const physics3dSetBodyKind = vi.fn(() => true);

const mockBridge = {
  variant: 'physics3d' as const,
  getPhysicsBridge: vi.fn(() => ({
    physics3d_init: physics3dInit,
    physics3d_step: physics3dStep,
    physics3d_add_body: physics3dAddBody,
    physics3d_remove_body: physics3dRemoveBody,
    physics3d_get_body_state: physics3dGetBodyState,
    physics3d_set_body_state: physics3dSetBodyState,
    physics3d_get_linear_velocity: physics3dGetLinearVelocity,
    physics3d_set_linear_velocity: vi.fn(() => true),
    physics3d_get_angular_velocity: physics3dGetAngularVelocity,
    physics3d_set_angular_velocity: vi.fn(() => true),
    physics3d_apply_impulse: vi.fn(() => true),
    physics3d_get_body_kind: physics3dGetBodyKind,
    physics3d_set_body_kind: physics3dSetBodyKind,
    physics3d_get_collision_events_ptr: physics3dGetCollisionEventsPtr,
    physics3d_get_collision_event_count: physics3dGetCollisionEventCount,
    physics3d_consume_events: physics3dConsumeEvents,
    get memory() {
      return mockMemoryBuffer ? { buffer: mockMemoryBuffer } : undefined;
    },
  })),
  getLinearMemory: vi.fn(() => (mockMemoryBuffer ? { buffer: mockMemoryBuffer } : null)),
  getEntityGeneration: vi.fn((_slot: number) => 0),
};

vi.mock('@gwenjs/core', () => ({
  getWasmBridge: () => mockBridge,
  unpackEntityId: (id: bigint) => ({
    index: Number(id & 0xffffffffn),
    generation: Number((id >> 32n) & 0xffffffffn),
  }),
  createEntityId: (index: number, generation: number) =>
    BigInt(index) | (BigInt(generation) << 32n),
}));

import { Physics3DPlugin, type Physics3DAPI } from '../src/index';
import type { GwenEngine } from '@gwenjs/core';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a mock WASM event ring buffer for the given events.
 *
 * Matches the Rust `PhysicsCollisionEvent3D` #[repr(C)] layout (16 bytes):
 * [entity_a u32][entity_b u32][flags u32][collider_a_id u16][collider_b_id u16]
 * Absent collider id sentinel: u16::MAX = 0xFFFF.
 */
function buildEventBuffer(
  events: Array<{
    slotA: number;
    slotB: number;
    colliderIdA?: number;
    colliderIdB?: number;
    started: boolean;
  }>,
): ArrayBuffer {
  const EVENT_STRIDE = 16;
  const buf = new ArrayBuffer(events.length * EVENT_STRIDE);
  const view = new DataView(buf);

  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    const offset = i * EVENT_STRIDE;
    view.setUint32(offset, ev.slotA, true); // entity_a
    view.setUint32(offset + 4, ev.slotB, true); // entity_b
    view.setUint32(offset + 8, ev.started ? 1 : 0, true); // flags
    view.setUint16(offset + 12, ev.colliderIdA ?? 0xffff, true); // collider_a_id
    view.setUint16(offset + 14, ev.colliderIdB ?? 0xffff, true); // collider_b_id
  }

  return buf;
}

function makeEngine(generationFor: (slot: number) => number | undefined = () => 0) {
  const services = new Map<string, unknown>();
  const hookMap = new Map<string, (...args: unknown[]) => unknown>();

  const engine = {
    provide: vi.fn((name: string, value: unknown) => {
      services.set(name, value);
    }),
    inject: vi.fn((name: string) => services.get(name)),
    hooks: {
      hook: vi.fn((name: string, callback: (...args: unknown[]) => unknown) => {
        hookMap.set(name, callback);
        return vi.fn();
      }),
      callHook: vi.fn(),
    },
    getEntityGeneration: vi.fn((slot: number) => generationFor(slot)),
    query: vi.fn(() => []),
    getComponent: vi.fn(),
    wasmBridge: null,
  } as unknown as GwenEngine;

  return { engine, services, hookMap };
}

describe('Physics3D collision events — WASM backend mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEventCount = 0;
    mockEventsPtr = 0;
    mockMemoryBuffer = null;
    physics3dAddBody.mockReturnValue(true);
    physics3dRemoveBody.mockReturnValue(true);
  });

  function setup() {
    const { engine, services, hookMap } = makeEngine();
    const plugin = Physics3DPlugin();
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;
    return { plugin, service, engine, hookMap };
  }

  it('getCollisionContacts returns empty array when no events', () => {
    const { service } = setup();
    expect(service.getCollisionContacts()).toHaveLength(0);
  });

  it('reads events from the ring buffer and dispatches the hook', () => {
    const { plugin, service, engine } = setup();

    service.createBody(1);
    service.createBody(2);

    const buf = buildEventBuffer([
      { slotA: 1, slotB: 2, colliderIdA: 0, colliderIdB: 0, started: true },
    ]);
    mockMemoryBuffer = buf;
    mockEventCount = 1;
    mockEventsPtr = 0;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    expect(engine.hooks.callHook).toHaveBeenCalledWith(
      'physics3d:collision',
      expect.arrayContaining([
        expect.objectContaining({ aColliderId: 0, bColliderId: 0, started: true }),
      ]),
    );
  });

  it('populates getCollisionContacts after onUpdate', () => {
    const { plugin, service } = setup();

    service.createBody(10);
    service.createBody(20);

    const buf = buildEventBuffer([
      { slotA: 10, slotB: 20, started: true },
      { slotA: 10, slotB: 20, started: false },
    ]);
    mockMemoryBuffer = buf;
    mockEventCount = 2;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    const contacts = service.getCollisionContacts();
    expect(contacts).toHaveLength(2);
    expect(contacts[0].started).toBe(true);
    expect(contacts[1].started).toBe(false);
  });

  it('does not dispatch hook when contact list is empty', () => {
    const { plugin, engine } = setup();

    mockEventCount = 0;
    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    expect(engine.hooks.callHook).not.toHaveBeenCalledWith(
      'physics3d:collision',
      expect.anything(),
    );
  });

  it('calls physics3d_consume_events after reading', () => {
    const { plugin, service } = setup();

    service.createBody(5);
    service.createBody(6);

    const buf = buildEventBuffer([{ slotA: 5, slotB: 6, started: true }]);
    mockMemoryBuffer = buf;
    mockEventCount = 1;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    expect(physics3dConsumeEvents).toHaveBeenCalledTimes(1);
  });

  it('parses absent collider ids as undefined', () => {
    const { plugin, service } = setup();

    service.createBody(7);
    service.createBody(8);

    const buf = buildEventBuffer([
      { slotA: 7, slotB: 8, colliderIdA: undefined, colliderIdB: undefined, started: true },
    ]);
    mockMemoryBuffer = buf;
    mockEventCount = 1;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    const contacts = service.getCollisionContacts();
    expect(contacts[0].aColliderId).toBeUndefined();
    expect(contacts[0].bColliderId).toBeUndefined();
  });

  it('updates sensor state from events with collider ids', () => {
    const { plugin, service, engine } = setup();

    service.createBody(11);
    service.createBody(12);

    const sensorId = 0xf007;
    const buf = buildEventBuffer([
      { slotA: 11, slotB: 12, colliderIdA: sensorId, colliderIdB: 100, started: true },
    ]);
    mockMemoryBuffer = buf;
    mockEventCount = 1;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    // Sensor state for entity 11 (created as bigint 11n via the contacts)
    // Since we're in WASM mode and entity ids resolve through createEntityId,
    // we check that the sensor hook was called
    expect(engine.hooks.callHook).toHaveBeenCalledWith(
      'physics3d:sensor:changed',
      expect.anything(), // entityId
      sensorId,
      expect.objectContaining({ isActive: true, contactCount: 1 }),
    );
  });

  it('dispatches sensor:changed when sensor transitions to inactive', () => {
    const { plugin, service, engine } = setup();

    service.createBody(13);
    service.createBody(14);

    const sensorId = 0xf007;

    // First: start contact
    {
      const buf = buildEventBuffer([
        { slotA: 13, slotB: 14, colliderIdA: sensorId, colliderIdB: 0, started: true },
      ]);
      mockMemoryBuffer = buf;
      mockEventCount = 1;
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
    }

    vi.clearAllMocks();

    // Second: end contact
    {
      const buf = buildEventBuffer([
        { slotA: 13, slotB: 14, colliderIdA: sensorId, colliderIdB: 0, started: false },
      ]);
      mockMemoryBuffer = buf;
      mockEventCount = 1;
      plugin.onBeforeUpdate!(1 / 60);
      plugin.onUpdate!();
    }

    expect(engine.hooks.callHook).toHaveBeenCalledWith(
      'physics3d:sensor:changed',
      expect.anything(),
      sensorId,
      expect.objectContaining({ isActive: false }),
    );
  });

  it('getCollisionEventMetrics reflects the number of events read this frame', () => {
    const { plugin, service } = setup();

    service.createBody(30);
    service.createBody(31);

    expect(service.getCollisionEventMetrics().eventCount).toBe(0);

    const buf = buildEventBuffer([
      { slotA: 30, slotB: 31, started: true },
      { slotA: 30, slotB: 31, started: false },
    ]);
    mockMemoryBuffer = buf;
    mockEventCount = 2;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    expect(service.getCollisionEventMetrics().eventCount).toBe(2);
  });

  it('calls per-entity collision callbacks', () => {
    const callback = vi.fn();

    const { plugin, service, engine } = setup();
    // Manually add a callback for slot 20
    service.createBody(20n, {
      colliders: [{ shape: { type: 'box', halfX: 0.5, halfY: 0.5, halfZ: 0.5 } }],
    });
    service.createBody(21n);

    // Directly call the prefab handler to register callback for entity 20
    const prefabHandler = (engine as any).hooks.hook.mock.calls.find(
      ([name]: [string]) => name === 'prefab:instantiate',
    )?.[1];
    if (prefabHandler) {
      prefabHandler(20n, { physics3d: { body: {}, onCollision: callback } });
    }

    const buf = buildEventBuffer([{ slotA: 20, slotB: 21, started: true }]);
    mockMemoryBuffer = buf;
    mockEventCount = 1;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(
      expect.anything(), // entityA
      expect.anything(), // entityB
      expect.objectContaining({ started: true }),
    );
  });

  it('getCollisionContacts respects the max option', () => {
    const { plugin, service } = setup();

    service.createBody(40);
    service.createBody(41);
    service.createBody(42);

    const buf = buildEventBuffer([
      { slotA: 40, slotB: 41, started: true },
      { slotA: 40, slotB: 42, started: true },
      { slotA: 41, slotB: 42, started: false },
    ]);
    mockMemoryBuffer = buf;
    mockEventCount = 3;

    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    // Without max: all 3 contacts returned
    expect(service.getCollisionContacts()).toHaveLength(3);

    // With max: only the first 2 contacts returned
    const capped = service.getCollisionContacts({ max: 2 });
    expect(capped).toHaveLength(2);
    expect(capped[0].started).toBe(true);
    expect(capped[1].started).toBe(true);

    // max of 0 returns empty array
    expect(service.getCollisionContacts({ max: 0 })).toHaveLength(0);

    // max larger than available contacts returns all
    expect(service.getCollisionContacts({ max: 100 })).toHaveLength(3);
  });
});

describe('Physics3D collision events — local mode', () => {
  it('getCollisionContacts returns empty array in local mode', () => {
    // Override the mock bridge for this test to remove physics3d_add_body,
    // which forces the plugin into local simulation mode.
    mockBridge.getPhysicsBridge.mockReturnValueOnce({
      physics3d_init: vi.fn(),
      physics3d_step: vi.fn(),
      // Intentionally no physics3d_add_body — forces local backend mode
    } as any);

    const { engine, services } = makeEngine();
    const plugin = Physics3DPlugin();
    plugin.setup(engine);
    const service = services.get('physics3d') as Physics3DAPI;

    // No events should exist in local mode — ring buffer is never consulted
    mockEventCount = 0;
    plugin.onBeforeUpdate!(1 / 60);
    plugin.onUpdate!();

    expect(service.getCollisionContacts()).toHaveLength(0);
  });
});
