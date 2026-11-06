/**
 * Packed collision rows. Stride 16 is the 3D layout. Stride 20 is the live 2D layout.
 */

import { describe, expect, it } from "vitest";
import * as api from "../src/index.js";
import type { CollisionEventLayout, InternalCollisionEvent } from "../src/index.js";

function blank(): InternalCollisionEvent {
  return { slotA: -1, slotB: -1, aColliderId: 111, bColliderId: 222, started: true };
}

function buffer(bytes: number): DataView {
  return new DataView(new ArrayBuffer(bytes));
}

function write16(
  view: DataView,
  index: number,
  slotA: number,
  slotB: number,
  flags: number,
  colA: number,
  colB: number,
): void {
  const base = index * 16;
  view.setUint32(base, slotA, true);
  view.setUint32(base + 4, slotB, true);
  view.setUint32(base + 8, flags, true);
  view.setUint16(base + 12, colA, true);
  view.setUint16(base + 14, colB, true);
}

function write20(
  view: DataView,
  index: number,
  slotA: number,
  slotB: number,
  colA: number,
  colB: number,
  flags: number,
): void {
  const base = index * 20;
  view.setUint32(base, slotA, true);
  view.setUint32(base + 4, slotB, true);
  view.setUint32(base + 8, colA, true);
  view.setUint32(base + 12, colB, true);
  view.setUint8(base + 16, flags);
}

const LAYOUT_16: CollisionEventLayout = { stride: 16, idWidth: 2 };
const LAYOUT_20: CollisionEventLayout = { stride: 20, idWidth: 4 };

describe("readCollisionEvents", () => {
  it("reads the 16-byte layout", () => {
    expect(typeof api.readCollisionEvents).toBe("function");
    const view = buffer(32);
    write16(view, 0, 11, 22, 1, 7, 8);
    write16(view, 1, 33, 44, 0, 9, 10);
    const pool = [blank(), blank()];
    const count = api.readCollisionEvents(view, 2, pool, LAYOUT_16);
    expect(count).toBe(2);
    expect(pool[0]).toEqual({
      slotA: 11,
      slotB: 22,
      aColliderId: 7,
      bColliderId: 8,
      started: true,
    });
    expect(pool[1]).toEqual({
      slotA: 33,
      slotB: 44,
      aColliderId: 9,
      bColliderId: 10,
      started: false,
    });
  });

  it("reads the 20-byte layout", () => {
    expect(typeof api.readCollisionEvents).toBe("function");
    const view = buffer(40);
    write20(view, 0, 11, 22, 7, 8, 1);
    write20(view, 1, 33, 44, 9, 10, 0);
    const pool = [blank(), blank()];
    const count = api.readCollisionEvents(view, 2, pool, LAYOUT_20);
    expect(count).toBe(2);
    expect(pool[0]).toEqual({
      slotA: 11,
      slotB: 22,
      aColliderId: 7,
      bColliderId: 8,
      started: true,
    });
    expect(pool[1]).toEqual({
      slotA: 33,
      slotB: 44,
      aColliderId: 9,
      bColliderId: 10,
      started: false,
    });
  });

  it("0xffff means absent", () => {
    expect(typeof api.readCollisionEvents).toBe("function");
    const narrow = buffer(16);
    write16(narrow, 0, 1, 2, 1, 0xffff, 0xfffe);
    const narrowPool = [blank()];
    expect(api.readCollisionEvents(narrow, 1, narrowPool, LAYOUT_16)).toBe(1);
    expect(narrowPool[0]).toEqual({
      slotA: 1,
      slotB: 2,
      bColliderId: 65534,
      started: true,
    });

    const wide = buffer(20);
    write20(wide, 0, 1, 2, 0xffffffff, 0xfffffffe, 1);
    const widePool = [blank()];
    expect(api.readCollisionEvents(wide, 1, widePool, LAYOUT_20)).toBe(1);
    expect(widePool[0]).toEqual({
      slotA: 1,
      slotB: 2,
      bColliderId: 4294967294,
      started: true,
    });
  });

  it("count 0 and the pool cap", () => {
    expect(typeof api.readCollisionEvents).toBe("function");
    const view = buffer(16);
    write16(view, 0, 11, 22, 1, 7, 8);
    const idle = [blank()];
    const idleEvent = idle[0];
    if (idleEvent === undefined) throw new Error("missing pool slot");
    idleEvent.slotA = 9;
    expect(api.readCollisionEvents(view, 0, idle, LAYOUT_16)).toBe(0);
    expect(idleEvent.slotA).toBe(9);
    expect(idle.length).toBe(1);

    const capped = [blank()];
    expect(api.readCollisionEvents(view, 4, capped, LAYOUT_16)).toBe(1);
    expect(capped.length).toBe(1);
    expect(capped[0]?.slotA).toBe(11);
  });
});
