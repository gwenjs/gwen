/**
 * @file SAB ring buffer for zero-copy collision event delivery.
 *
 * WASM fills the ring buffer per frame; TypeScript reads in one pass per frame.
 * Layout (per contact event, 32 bytes):
 *   offset  0: entityA index  (u32)
 *   offset  4: entityB index  (u32)
 *   offset  8: contactX       (f32)
 *   offset 12: contactY       (f32)
 *   offset 16: normalX        (f32)
 *   offset 20: normalY        (f32)
 *   offset 24: relativeVel    (f32)
 *   offset 28: flags          (u32) — bit 0: isSensor, bit 1: enter, bit 2: exit
 */

export const CONTACT_EVENT_BYTES = 32;

/** Maximum events per frame before oldest are overwritten. */
export const RING_CAPACITY = 512;

export class ContactRingBuffer {
  private readonly _sab: SharedArrayBuffer;
  private readonly _u32: Uint32Array;
  private readonly _f32: Float32Array;
  /** Write head (incremented by WASM). */
  private _writeHead = 0;
  /** Read head (incremented by TypeScript). */
  private _readHead = 0;

  constructor(sab?: SharedArrayBuffer) {
    this._sab = sab ?? new SharedArrayBuffer(CONTACT_EVENT_BYTES * RING_CAPACITY);
    this._u32 = new Uint32Array(this._sab);
    this._f32 = new Float32Array(this._sab);
  }

  get sab(): SharedArrayBuffer {
    return this._sab;
  }

  /**
   * Read all pending events since last call.
   * Returns array of parsed contact event objects.
   * Called once per frame by the physics2d plugin.
   *
   * In production, WASM writes the full packed EntityId (slot | gen<<32) into the u32 pair.
   * In tests, the {@link write} helper accepts raw indices.
   */
  drain(): {
    entityA: bigint;
    entityB: bigint;
    contactX: number;
    contactY: number;
    normalX: number;
    normalY: number;
    relativeVelocity: number;
    isSensor: boolean;
    isEnter: boolean;
    isExit: boolean;
  }[] {
    const events: ReturnType<ContactRingBuffer['drain']> = [];
    while (this._readHead !== this._writeHead) {
      const slot = this._readHead % RING_CAPACITY;
      const base = slot * (CONTACT_EVENT_BYTES / 4);
      events.push({
        entityA: BigInt(this._u32[base]), // raw index — WASM writes packed ID here in production
        entityB: BigInt(this._u32[base + 1]),
        contactX: this._f32[base + 2],
        contactY: this._f32[base + 3],
        normalX: this._f32[base + 4],
        normalY: this._f32[base + 5],
        relativeVelocity: this._f32[base + 6],
        isSensor: (this._u32[base + 7] & 1) !== 0,
        isEnter: (this._u32[base + 7] & 2) !== 0,
        isExit: (this._u32[base + 7] & 4) !== 0,
      });
      this._readHead++;
    }
    return events;
  }

  /** Write an event (used by tests and WASM bridge adapter). */
  write(event: {
    entityAIdx: number;
    entityBIdx: number;
    contactX: number;
    contactY: number;
    normalX: number;
    normalY: number;
    relativeVelocity: number;
    isSensor?: boolean;
    isEnter?: boolean;
    isExit?: boolean;
  }): void {
    const slot = this._writeHead % RING_CAPACITY;
    const base = slot * (CONTACT_EVENT_BYTES / 4);
    this._u32[base] = event.entityAIdx;
    this._u32[base + 1] = event.entityBIdx;
    this._f32[base + 2] = event.contactX;
    this._f32[base + 3] = event.contactY;
    this._f32[base + 4] = event.normalX;
    this._f32[base + 5] = event.normalY;
    this._f32[base + 6] = event.relativeVelocity;
    let flags = 0;
    if (event.isSensor) flags |= 1;
    if (event.isEnter) flags |= 2;
    if (event.isExit) flags |= 4;
    this._u32[base + 7] = flags;
    this._writeHead++;
  }
}
