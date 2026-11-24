/**
 * One reused event buffer for the 3D adapter.
 *
 * WASM frames copy the live bytes. Local frames encode the same 16-byte layout.
 * An absent collider id is `0xffff` (`packages/physics3d/src/plugin/constants.ts:13`).
 */

import type { InternalCollisionEvent3D } from "./bridge";
import { COLLIDER_ID_ABSENT, EVENT_STRIDE_3D } from "./constants";
import { uncheckedAt } from "../internal/unchecked";

/** The object `eventView` returns on every frame. */
export interface StagedEventBuffer {
  view: DataView;
  count: number;
}

/** Empty buffer. The first frame grows it. Later frames reuse it. */
export function createStagedEventBuffer(): StagedEventBuffer {
  return { view: new DataView(new ArrayBuffer(0)), count: 0 };
}

function grow(staged: StagedEventBuffer, bytes: number): void {
  if (staged.view.byteLength >= bytes) return;
  let next = staged.view.byteLength === 0 ? EVENT_STRIDE_3D : staged.view.byteLength * 2;
  while (next < bytes) next *= 2;
  staged.view = new DataView(new ArrayBuffer(next));
}

/**
 * Copy `count` events from the live WASM view into the reused buffer.
 * The caller consumes the live buffer after this returns.
 */
export function copyWasmEvents(staged: StagedEventBuffer, source: DataView, count: number): void {
  const bytes = count * EVENT_STRIDE_3D;
  grow(staged, bytes);
  if (bytes > 0) {
    const src = new Uint8Array(source.buffer, source.byteOffset, bytes);
    new Uint8Array(staged.view.buffer, staged.view.byteOffset, bytes).set(src);
  }
  staged.count = count;
}

/**
 * Encode local collision pairs into the reused buffer.
 * A missing collider id is written as `0xffff`.
 */
export function encodeLocalEvents(
  staged: StagedEventBuffer,
  events: readonly InternalCollisionEvent3D[],
): void {
  const bytes = events.length * EVENT_STRIDE_3D;
  grow(staged, bytes);
  const view = staged.view;
  for (let index = 0; index < events.length; index += 1) {
    const event = uncheckedAt(events, index);
    const base = index * EVENT_STRIDE_3D;
    view.setUint32(base, event.slotA, true);
    view.setUint32(base + 4, event.slotB, true);
    view.setUint32(base + 8, event.started ? 1 : 0, true);
    view.setUint16(base + 12, event.aColliderId ?? COLLIDER_ID_ABSENT, true);
    view.setUint16(base + 14, event.bColliderId ?? COLLIDER_ID_ABSENT, true);
  }
  staged.count = events.length;
}
