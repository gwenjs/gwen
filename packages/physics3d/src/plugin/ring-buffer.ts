/**
 * @file SAB ring buffer for zero-copy 3D collision event delivery.
 *
 * Layout per contact event (40 bytes / 10 × f32 slots):
 *   [0]  entityA index  (u32 reinterpreted via Uint32Array view)
 *   [1]  entityB index  (u32 reinterpreted)
 *   [2]  contactX       (f32)
 *   [3]  contactY       (f32)
 *   [4]  contactZ       (f32)
 *   [5]  normalX        (f32)
 *   [6]  normalY        (f32)
 *   [7]  normalZ        (f32)
 *   [8]  relativeVel    (f32)
 *   [9]  restitution    (f32)
 *
 * entityA/B are written/read via the Uint32Array view at the same offsets.
 */

import type { ContactEvent3D } from '../types';

/** Number of f32 slots per contact event record. */
export const CONTACT_EVENT_FLOATS = 10;

/** Maximum number of contact events that fit in the ring buffer at once. */
export const RING_CAPACITY_3D = 512;

/**
 * Lock-free single-producer / single-consumer ring buffer for 3D contact events.
 *
 * Backed by a {@link SharedArrayBuffer} so the WASM worker thread can write events
 * without any JS-side allocation. Both the {@link Float32Array} and {@link Uint32Array}
 * views share the same underlying SAB memory, enabling the entity index fields
 * (stored as u32) to be read from the same buffer as the floating-point fields.
 *
 * @example
 * ```typescript
 * const buf = new ContactRingBuffer3D();
 * buf.write({ entityAIdx: 0, entityBIdx: 1, contactX: 1, contactY: 0, contactZ: 0,
 *             normalX: 0, normalY: 1, normalZ: 0, relativeVelocity: 5, restitution: 0.3 });
 * const events = buf.drain(); // ContactEvent3D[]
 * ```
 */
export class ContactRingBuffer3D {
  private readonly _sab: SharedArrayBuffer;
  private readonly _f32: Float32Array;
  private readonly _u32: Uint32Array;
  private _writeHead = 0;
  private _readHead = 0;

  /**
   * Create a new ContactRingBuffer3D, optionally reusing an existing SAB.
   *
   * @param sab - Optional existing {@link SharedArrayBuffer} to wrap. When
   *   omitted, a new SAB of the correct size is allocated automatically.
   */
  constructor(sab?: SharedArrayBuffer) {
    const byteLength = CONTACT_EVENT_FLOATS * 4 * RING_CAPACITY_3D;
    this._sab = sab ?? new SharedArrayBuffer(byteLength);
    this._f32 = new Float32Array(this._sab);
    this._u32 = new Uint32Array(this._sab);
  }

  /**
   * The underlying {@link SharedArrayBuffer} backing this ring buffer.
   * Transfer this to a worker thread to allow zero-copy event production.
   */
  get sab(): SharedArrayBuffer {
    return this._sab;
  }

  /**
   * Read all pending contact events since the last {@link drain} call.
   *
   * @returns An array of {@link ContactEvent3D} objects. Returns an empty array
   *   when no new events are available.
   */
  drain(): ContactEvent3D[] {
    const events: ContactEvent3D[] = [];
    while (this._readHead !== this._writeHead) {
      const slot = this._readHead % RING_CAPACITY_3D;
      const base = slot * CONTACT_EVENT_FLOATS;
      events.push({
        entityA: BigInt(this._u32[base]),
        entityB: BigInt(this._u32[base + 1]),
        contactX: this._f32[base + 2],
        contactY: this._f32[base + 3],
        contactZ: this._f32[base + 4],
        normalX: this._f32[base + 5],
        normalY: this._f32[base + 6],
        normalZ: this._f32[base + 7],
        relativeVelocity: this._f32[base + 8],
        restitution: this._f32[base + 9],
      });
      this._readHead++;
    }
    return events;
  }

  /**
   * Write a single contact event into the ring buffer.
   *
   * Used by the WASM bridge and in unit tests to simulate incoming contact events.
   * When the buffer wraps, older unread events are overwritten silently.
   *
   * @param event - The contact event data to write.
   */
  write(event: {
    entityAIdx: number;
    entityBIdx: number;
    contactX: number;
    contactY: number;
    contactZ: number;
    normalX: number;
    normalY: number;
    normalZ: number;
    relativeVelocity: number;
    restitution: number;
  }): void {
    const slot = this._writeHead % RING_CAPACITY_3D;
    const base = slot * CONTACT_EVENT_FLOATS;
    this._u32[base] = event.entityAIdx;
    this._u32[base + 1] = event.entityBIdx;
    this._f32[base + 2] = event.contactX;
    this._f32[base + 3] = event.contactY;
    this._f32[base + 4] = event.contactZ;
    this._f32[base + 5] = event.normalX;
    this._f32[base + 6] = event.normalY;
    this._f32[base + 7] = event.normalZ;
    this._f32[base + 8] = event.relativeVelocity;
    this._f32[base + 9] = event.restitution;
    this._writeHead++;
  }
}
