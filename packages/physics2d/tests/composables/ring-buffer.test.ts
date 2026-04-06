/**
 * @file ContactRingBuffer tests.
 */
import { describe, it, expect } from 'vitest';
import { ContactRingBuffer } from '../../src/ring-buffer.js';

describe('ContactRingBuffer', () => {
  it('drain returns an empty array when nothing has been written', () => {
    expect(new ContactRingBuffer().drain()).toHaveLength(0);
  });

  it('round-trips a single contact event', () => {
    const buf = new ContactRingBuffer();
    buf.write({
      entityAIdx: 1,
      entityBIdx: 2,
      contactX: 3,
      contactY: 4,
      normalX: 0,
      normalY: 1,
      relativeVelocity: 10,
    });
    const [ev] = buf.drain();
    expect(ev.entityA).toBe(1n);
    expect(ev.entityB).toBe(2n);
    expect(ev.contactX).toBe(3);
    expect(ev.contactY).toBe(4);
    expect(ev.normalX).toBe(0);
    expect(ev.normalY).toBe(1);
    expect(ev.relativeVelocity).toBe(10);
  });

  it('drain is empty after draining once', () => {
    const buf = new ContactRingBuffer();
    buf.write({
      entityAIdx: 0,
      entityBIdx: 1,
      contactX: 0,
      contactY: 0,
      normalX: 1,
      normalY: 0,
      relativeVelocity: 0,
    });
    buf.drain();
    expect(buf.drain()).toHaveLength(0);
  });

  it('drains multiple events in order', () => {
    const buf = new ContactRingBuffer();
    for (let i = 0; i < 5; i++) {
      buf.write({
        entityAIdx: i,
        entityBIdx: i + 1,
        contactX: 0,
        contactY: 0,
        normalX: 0,
        normalY: 1,
        relativeVelocity: i * 2,
      });
    }
    const events = buf.drain();
    expect(events).toHaveLength(5);
    for (let i = 0; i < 5; i++) {
      expect(events[i].entityA).toBe(BigInt(i));
      expect(events[i].relativeVelocity).toBe(i * 2);
    }
  });

  it('correctly encodes and decodes isSensor flag (bit 0)', () => {
    const buf = new ContactRingBuffer();
    buf.write({
      entityAIdx: 0,
      entityBIdx: 1,
      contactX: 0,
      contactY: 0,
      normalX: 0,
      normalY: 1,
      relativeVelocity: 0,
      isSensor: true,
    });
    const [ev] = buf.drain();
    expect(ev.isSensor).toBe(true);
  });

  it('correctly encodes and decodes isEnter flag (bit 1)', () => {
    const buf = new ContactRingBuffer();
    buf.write({
      entityAIdx: 0,
      entityBIdx: 1,
      contactX: 0,
      contactY: 0,
      normalX: 0,
      normalY: 1,
      relativeVelocity: 0,
      isEnter: true,
    });
    const [ev] = buf.drain();
    expect(ev.isEnter).toBe(true);
    expect(ev.isExit).toBe(false);
  });

  it('correctly encodes and decodes isExit flag (bit 2)', () => {
    const buf = new ContactRingBuffer();
    buf.write({
      entityAIdx: 0,
      entityBIdx: 1,
      contactX: 0,
      contactY: 0,
      normalX: 0,
      normalY: 1,
      relativeVelocity: 0,
      isExit: true,
    });
    const [ev] = buf.drain();
    expect(ev.isExit).toBe(true);
    expect(ev.isEnter).toBe(false);
  });

  it('isSensor, isEnter, isExit default to false when not specified', () => {
    const buf = new ContactRingBuffer();
    buf.write({
      entityAIdx: 0,
      entityBIdx: 1,
      contactX: 0,
      contactY: 0,
      normalX: 0,
      normalY: 1,
      relativeVelocity: 0,
    });
    const [ev] = buf.drain();
    expect(ev.isSensor).toBe(false);
    expect(ev.isEnter).toBe(false);
    expect(ev.isExit).toBe(false);
  });

  it('exposes the underlying SharedArrayBuffer via .sab', () => {
    const buf = new ContactRingBuffer();
    expect(buf.sab).toBeInstanceOf(SharedArrayBuffer);
  });

  it('accepts an external SharedArrayBuffer in constructor', async () => {
    const { CONTACT_EVENT_BYTES, RING_CAPACITY } = await import('../../src/ring-buffer.js');
    const sab = new SharedArrayBuffer(CONTACT_EVENT_BYTES * RING_CAPACITY);
    const buf = new ContactRingBuffer(sab);
    expect(buf.sab).toBe(sab);
  });
});
