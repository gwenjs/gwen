/**
 * @fileoverview Collision event reading (WASM ring buffer) and local AABB detection.
 */

import type { InternalCollisionEvent3D } from './bridge';
import { EVENT_STRIDE_3D, MAX_EVENTS_3D, COLLIDER_ID_ABSENT } from './constants';
import { computeColliderAABB, aabbOverlap } from './physics3d-utils';
import type { PluginContext } from './plugin-context';

// ─── AABB collision detection (local mode) ────────────────────────────────────

/**
 * Axis-Aligned Bounding Box collision pair detection.
 * Runs O(N²) — acceptable for fallback mode with fewer than 200 bodies.
 *
 * Compares the current overlapping pairs against the previous frame to
 * produce `started` / ended transition events.
 */
export function detectLocalCollisions(ctx: PluginContext): InternalCollisionEvent3D[] {
  const currentKeys = new Set<string>();
  type PairRecord = {
    slotA: number;
    slotB: number;
    colliderIdA: number | undefined;
    colliderIdB: number | undefined;
    key: string;
  };
  const currentPairs: PairRecord[] = [];
  // Refill the pre-allocated slot buffer to avoid a per-frame spread allocation.
  ctx._slotsBuffer.length = 0;
  for (const key of ctx.bodyByEntity.keys()) ctx._slotsBuffer.push(key);
  const slots = ctx._slotsBuffer;

  for (let i = 0; i < slots.length; i++) {
    const slotA = slots[i]!;
    const stateA = ctx.stateByEntity.get(slotA);
    const collidersA = ctx.localColliders.get(slotA);
    if (!stateA || !collidersA || collidersA.length === 0) continue;

    for (let j = i + 1; j < slots.length; j++) {
      const slotB = slots[j]!;
      const stateB = ctx.stateByEntity.get(slotB);
      const collidersB = ctx.localColliders.get(slotB);
      if (!stateB || !collidersB || collidersB.length === 0) continue;

      for (const colA of collidersA) {
        const aabbA = computeColliderAABB(stateA.position, colA);
        for (const colB of collidersB) {
          const aabbB = computeColliderAABB(stateB.position, colB);
          if (!aabbOverlap(aabbA, aabbB)) continue;
          const cIdA = colA.colliderId;
          const cIdB = colB.colliderId;
          const key = `${slotA}:${cIdA ?? -1}:${slotB}:${cIdB ?? -1}`;
          if (!currentKeys.has(key)) {
            currentKeys.add(key);
            currentPairs.push({ slotA, slotB, colliderIdA: cIdA, colliderIdB: cIdB, key });
          }
        }
      }
    }
  }

  const events: InternalCollisionEvent3D[] = [];

  // Newly overlapping pairs → contact started
  for (const pair of currentPairs) {
    if (!ctx.previousLocalContactKeys.has(pair.key)) {
      events.push({
        slotA: pair.slotA,
        slotB: pair.slotB,
        aColliderId: pair.colliderIdA,
        bColliderId: pair.colliderIdB,
        started: true,
      });
    }
  }

  // Previously overlapping pairs that no longer overlap → contact ended
  for (const prevKey of ctx.previousLocalContactKeys) {
    if (!currentKeys.has(prevKey)) {
      const parts = prevKey.split(':');
      const slotA = parseInt(parts[0] ?? '0', 10);
      const rawCIdA = parseInt(parts[1] ?? '-1', 10);
      const slotB = parseInt(parts[2] ?? '0', 10);
      const rawCIdB = parseInt(parts[3] ?? '-1', 10);
      events.push({
        slotA,
        slotB,
        aColliderId: rawCIdA === -1 ? undefined : rawCIdA,
        bColliderId: rawCIdB === -1 ? undefined : rawCIdB,
        started: false,
      });
    }
  }

  ctx.previousLocalContactKeys = currentKeys;
  return events;
}

// ─── WASM collision event reading ──────────────────────────────────────────────

/**
 * Read pending collision events from the WASM ring buffer.
 *
 * Event layout (16 bytes per slot):
 * [slotA u32 LE][slotB u32 LE][flags u32 LE][colliderIdA u16 LE][colliderIdB u16 LE]
 * flags bit 0: 1 = contact started, 0 = contact ended
 */
export function readWasmCollisionEvents(ctx: PluginContext): InternalCollisionEvent3D[] {
  if (!ctx.wasmBridge) return [];
  const pb = ctx.wasmBridge;
  if (!pb.physics3d_get_collision_events_ptr || !pb.physics3d_get_collision_event_count) {
    return [];
  }

  const memory = ctx.bridgeRuntime?.getLinearMemory?.() ?? pb.memory ?? null;
  if (!memory) return [];

  const ptr = pb.physics3d_get_collision_events_ptr();
  const count = Math.min(pb.physics3d_get_collision_event_count(), MAX_EVENTS_3D);
  if (count === 0) return [];

  const availableBytes = memory.buffer.byteLength - ptr;
  if (availableBytes <= 0) return [];

  if (!ctx.eventsView || ctx.eventsBufferRef !== memory.buffer || ctx.eventsView.byteLength === 0) {
    ctx.eventsBufferRef = memory.buffer;
    ctx.eventsView = new DataView(memory.buffer, ptr, availableBytes);
  }

  // Reuse pooled array
  ctx.pooledEvents.length = count;
  for (let i = 0; i < count; i++) {
    const base = i * EVENT_STRIDE_3D;
    const slotA = ctx.eventsView.getUint32(base, true);
    const slotB = ctx.eventsView.getUint32(base + 4, true);
    const rawFlags = ctx.eventsView.getUint32(base + 8, true);
    const rawColliderA = ctx.eventsView.getUint16(base + 12, true);
    const rawColliderB = ctx.eventsView.getUint16(base + 14, true);

    const existing = ctx.pooledEvents[i];
    if (existing) {
      existing.slotA = slotA;
      existing.slotB = slotB;
      existing.aColliderId = rawColliderA === COLLIDER_ID_ABSENT ? undefined : rawColliderA;
      existing.bColliderId = rawColliderB === COLLIDER_ID_ABSENT ? undefined : rawColliderB;
      existing.started = (rawFlags & 1) === 1;
    } else {
      ctx.pooledEvents[i] = {
        slotA,
        slotB,
        aColliderId: rawColliderA === COLLIDER_ID_ABSENT ? undefined : rawColliderA,
        bColliderId: rawColliderB === COLLIDER_ID_ABSENT ? undefined : rawColliderB,
        started: (rawFlags & 1) === 1,
      };
    }
  }

  pb.physics3d_consume_events?.();
  ctx.lastFrameEventCount = count;
  return ctx.pooledEvents;
}
