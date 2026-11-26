import type { EngineMemory, MemoryView } from "./engine-memory.js";
import type { TransformPair3D } from "./transform-pair-3d.js";

const SLOT_FLOATS = 12;

/** Loop-owned 3D views. The public surface is `pair` only. */
export interface HistoryViews3D {
  readonly pair: TransformPair3D;
  setParity(index: number): void;
  dispose(): void;
}

/**
 * Four views over the two 3D history buffers.
 * Float views use `core:transform3d-history-0` and `core:transform3d-history-1`.
 * Flag views use the same bytes under a second name, because one memory name
 * cannot be registered twice.
 * Returns undefined when either pointer is 0 or `parity` is not 0 or 1.
 * Duplicated from the 2D installer on purpose: the 2D file is not edited.
 */
export function installHistoryViews3D(
  memory: EngineMemory,
  maxEntities: number,
  readPtr: (buffer: number) => number,
  parity: number,
): HistoryViews3D | undefined {
  const ptr0 = readPtr(0);
  const ptr1 = readPtr(1);
  if (ptr0 === 0 || ptr1 === 0) return undefined;
  if (parity !== 0 && parity !== 1) return undefined;
  const floats = maxEntities * SLOT_FLOATS;
  const length = (): number => floats;
  const f0 = memory.view({
    name: "core:transform3d-history-0",
    type: "f32",
    ptr: () => ptr0,
    length,
  });
  const f1 = memory.view({
    name: "core:transform3d-history-1",
    type: "f32",
    ptr: () => ptr1,
    length,
  });
  const u0 = memory.view({
    name: "core:transform3d-history-0-flags",
    type: "u32",
    ptr: () => ptr0,
    length,
  });
  const u1 = memory.view({
    name: "core:transform3d-history-1-flags",
    type: "u32",
    ptr: () => ptr1,
    length,
  });
  let current: 0 | 1 = parity === 0 ? 0 : 1;
  const pair: TransformPair3D = {
    get previous() {
      return current === 0 ? f1.array : f0.array;
    },
    get current() {
      return current === 0 ? f0.array : f1.array;
    },
    get previousFlags() {
      return current === 0 ? u1.array : u0.array;
    },
    get currentFlags() {
      return current === 0 ? u0.array : u1.array;
    },
  };
  const views: Array<MemoryView<"f32"> | MemoryView<"u32">> = [f0, f1, u0, u1];
  return {
    pair,
    setParity(index: number) {
      if (index === 0 || index === 1) current = index;
    },
    dispose() {
      for (const view of views) view.dispose();
    },
  };
}
