/**
 * @fileoverview Collision event reading (WASM ring buffer) and local AABB detection.
 */

import type { InternalCollisionEvent3D } from "./bridge";
import { EVENT_STRIDE_3D, MAX_EVENTS_3D } from "./constants";
import { computeColliderAABB, aabbOverlap } from "./physics3d-utils";
import type { PluginContext } from "./plugin-context";
import { uncheckedAt } from "../internal/unchecked";

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
    const slotA = uncheckedAt(slots, i);
    const stateA = ctx.stateByEntity.get(slotA);
    const collidersA = ctx.localColliders.get(slotA);
    if (!stateA || !collidersA || collidersA.length === 0) continue;

    for (let j = i + 1; j < slots.length; j++) {
      const slotB = uncheckedAt(slots, j);
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
      const parts = prevKey.split(":");
      const slotA = parseInt(parts[0] ?? "0", 10);
      const rawCIdA = parseInt(parts[1] ?? "-1", 10);
      const slotB = parseInt(parts[2] ?? "0", 10);
      const rawCIdB = parseInt(parts[3] ?? "-1", 10);
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
 * Live WASM collision bytes for this frame.
 *
 * Event layout (16 bytes per slot):
 * [slotA u32 LE][slotB u32 LE][flags u32 LE][colliderIdA u16 LE][colliderIdB u16 LE]
 * flags bit 0: 1 = contact started, 0 = contact ended.
 * This does not consume the buffer. The adapter copies, then consumes.
 *
 * @returns The live view and its event count, or `undefined` when this frame has none.
 */
export function readWasmEventView(
  ctx: PluginContext,
): { readonly view: DataView; readonly count: number } | undefined {
  const core = ctx.coreBridge;
  if (core === null) return undefined;
  const pb = core.getPhysicsBridge();
  if (!pb.physics3d_get_collision_events_ptr || !pb.physics3d_get_collision_event_count) {
    return undefined;
  }

  const memory = ctx.bridgeRuntime?.getLinearMemory?.() ?? pb.memory ?? null;
  if (!memory) return undefined;

  const count = Math.min(pb.physics3d_get_collision_event_count(), MAX_EVENTS_3D);
  if (count === 0) return undefined;

  const engine = ctx._engine;
  if (engine === null) return undefined;
  const ptr = pb.physics3d_get_collision_events_ptr();
  const available = memory.buffer.byteLength - ptr;
  if (available <= 0) return undefined;
  if (ctx.collisionEvents === null) {
    ctx.collisionEvents = engine.memory.view({
      name: "physics3d:collision-events",
      type: "dataview",
      ptr: () => ctx.coreBridge?.getPhysicsBridge().physics3d_get_collision_events_ptr?.() ?? 0,
      length: () => {
        const livePb = ctx.coreBridge?.getPhysicsBridge();
        const live = ctx.bridgeRuntime?.getLinearMemory?.() ?? livePb?.memory ?? null;
        const livePtr = livePb?.physics3d_get_collision_events_ptr?.() ?? 0;
        if (live === null) return 0;
        const liveAvailable = live.buffer.byteLength - livePtr;
        const cap = MAX_EVENTS_3D * EVENT_STRIDE_3D;
        if (liveAvailable <= 0) return 0;
        return liveAvailable > cap ? cap : liveAvailable;
      },
    });
  }
  const events = ctx.collisionEvents;
  if (events === null) return undefined;
  return { view: events.array, count };
}
