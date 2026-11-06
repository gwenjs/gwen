/**
 * Reads packed collision events out of a WASM buffer into a caller-owned pool.
 */

/** One event in the reader pool. Slot indices stay off the public contact. */
export interface InternalCollisionEvent {
  slotA: number;
  slotB: number;
  aColliderId?: number;
  bColliderId?: number;
  started: boolean;
}

/**
 * Byte layout of one event. The adapter picks the row that matches its struct.
 * - `{ stride: 16, idWidth: 2 }`: flags `u32` at +8, collider ids `u16` at +12 and +14.
 * - `{ stride: 20, idWidth: 4 }`: collider ids `u32` at +8 and +12, flags `u8` at +16.
 *
 * An absent collider id is `0xffff` for `idWidth` 2 and `0xffffffff` for `idWidth` 4.
 */
export type CollisionEventLayout =
  | { readonly stride: 16; readonly idWidth: 2 }
  | { readonly stride: 20; readonly idWidth: 4 };

const ABSENT_U16 = 0xffff;
const ABSENT_U32 = 0xffffffff;

function readColliderId(view: DataView, offset: number, idWidth: 2 | 4): number | undefined {
  const raw = idWidth === 2 ? view.getUint16(offset, true) : view.getUint32(offset, true);
  const absent = idWidth === 2 ? ABSENT_U16 : ABSENT_U32;
  if (raw === absent) return undefined;
  return raw;
}

function assignId(event: InternalCollisionEvent, side: "a" | "b", id: number | undefined): void {
  if (side === "a") {
    if (id === undefined) delete event.aColliderId;
    else event.aColliderId = id;
    return;
  }
  if (id === undefined) delete event.bColliderId;
  else event.bColliderId = id;
}

/**
 * Fill `pool` from `view` and return how many events were written.
 *
 * Stride 16 is the 3D layout (flags `u32` at +8, ids `u16` at +12/+14).
 * An id of `0xffff` is absent and the field is removed.
 * Stride 20 is the live 2D layout (ids `u32` at +8/+12, flags `u8` at +16).
 * An id of `0xffffffff` is absent and the field is removed.
 * `count` 0 writes nothing. A `count` past `pool.length` stops at the pool.
 */
export function readCollisionEvents(
  view: DataView,
  count: number,
  pool: InternalCollisionEvent[],
  layout: CollisionEventLayout,
): number {
  const stride = layout.stride;
  const idWidth = layout.idWidth;
  for (let index = 0; index < count; index += 1) {
    const event = pool[index];
    if (event === undefined) return index;
    const base = index * stride;
    if (stride === 16) {
      event.slotA = view.getUint32(base, true);
      event.slotB = view.getUint32(base + 4, true);
      event.started = (view.getUint32(base + 8, true) & 1) === 1;
      assignId(event, "a", readColliderId(view, base + 12, idWidth));
      assignId(event, "b", readColliderId(view, base + 14, idWidth));
    } else if (stride === 20) {
      event.slotA = view.getUint32(base, true);
      event.slotB = view.getUint32(base + 4, true);
      assignId(event, "a", readColliderId(view, base + 8, idWidth));
      assignId(event, "b", readColliderId(view, base + 12, idWidth));
      event.started = (view.getUint8(base + 16) & 1) === 1;
    }
  }
  return count;
}
