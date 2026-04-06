import { describe, it, expect } from 'vitest';
import {
  ContactRingBuffer3D,
  CONTACT_EVENT_FLOATS,
  RING_CAPACITY_3D,
} from '../src/plugin/ring-buffer.js';

describe('ContactRingBuffer3D', () => {
  it('exports the correct constants', () => {
    expect(CONTACT_EVENT_FLOATS).toBe(10);
    expect(RING_CAPACITY_3D).toBe(512);
  });

  it('returns an empty array when no events have been written', () => {
    const buf = new ContactRingBuffer3D();
    expect(buf.drain()).toEqual([]);
  });

  it('drains a single written event with correct field values', () => {
    const buf = new ContactRingBuffer3D();
    buf.write({
      entityAIdx: 5,
      entityBIdx: 12,
      contactX: 1.5,
      contactY: 2.0,
      contactZ: -3.25,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      relativeVelocity: 7.5,
      restitution: 0.3,
    });
    const events = buf.drain();
    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.entityA).toBe(5n);
    expect(e.entityB).toBe(12n);
    expect(e.contactX).toBeCloseTo(1.5, 4);
    expect(e.contactY).toBeCloseTo(2.0, 4);
    expect(e.contactZ).toBeCloseTo(-3.25, 4);
    expect(e.normalX).toBeCloseTo(0, 5);
    expect(e.normalY).toBeCloseTo(1, 5);
    expect(e.normalZ).toBeCloseTo(0, 5);
    expect(e.relativeVelocity).toBeCloseTo(7.5, 4);
    expect(e.restitution).toBeCloseTo(0.3, 4);
  });

  it('entityA and entityB are bigints', () => {
    const buf = new ContactRingBuffer3D();
    buf.write({
      entityAIdx: 0,
      entityBIdx: 1,
      contactX: 0,
      contactY: 0,
      contactZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      relativeVelocity: 0,
      restitution: 0,
    });
    const [e] = buf.drain();
    expect(typeof e.entityA).toBe('bigint');
    expect(typeof e.entityB).toBe('bigint');
  });

  it('correctly stores and retrieves the Z coordinate', () => {
    const buf = new ContactRingBuffer3D();
    buf.write({
      entityAIdx: 1,
      entityBIdx: 2,
      contactX: 0,
      contactY: 0,
      contactZ: 42.5,
      normalX: 0,
      normalY: 0,
      normalZ: -1,
      relativeVelocity: 0,
      restitution: 0,
    });
    const [e] = buf.drain();
    expect(e.contactZ).toBeCloseTo(42.5, 4);
    expect(e.normalZ).toBeCloseTo(-1, 5);
  });

  it('drains 3 consecutive events in order', () => {
    const buf = new ContactRingBuffer3D();
    for (let i = 0; i < 3; i++) {
      buf.write({
        entityAIdx: i,
        entityBIdx: i + 100,
        contactX: i,
        contactY: 0,
        contactZ: 0,
        normalX: 0,
        normalY: 1,
        normalZ: 0,
        relativeVelocity: i * 2,
        restitution: 0,
      });
    }
    const events = buf.drain();
    expect(events).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(events[i].entityA).toBe(BigInt(i));
      expect(events[i].entityB).toBe(BigInt(i + 100));
      expect(events[i].contactX).toBeCloseTo(i, 5);
      expect(events[i].relativeVelocity).toBeCloseTo(i * 2, 5);
    }
  });

  it('returns empty array on second drain with no new writes', () => {
    const buf = new ContactRingBuffer3D();
    buf.write({
      entityAIdx: 1,
      entityBIdx: 2,
      contactX: 0,
      contactY: 0,
      contactZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      relativeVelocity: 0,
      restitution: 0,
    });
    buf.drain();
    expect(buf.drain()).toHaveLength(0);
  });

  it('accepts an externally created SharedArrayBuffer', () => {
    const sab = new SharedArrayBuffer(CONTACT_EVENT_FLOATS * 4 * RING_CAPACITY_3D);
    const buf = new ContactRingBuffer3D(sab);
    expect(buf.sab).toBe(sab);
  });

  it('exposes the SAB via the sab getter', () => {
    const buf = new ContactRingBuffer3D();
    expect(buf.sab).toBeInstanceOf(SharedArrayBuffer);
  });
});
