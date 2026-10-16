import type { EngineMemory, MemoryView } from "./engine-memory.js";
import type { TransformPair2D } from "./transform-pair.js";

const SLOT_FLOATS = 8;

/** Loop-owned views. The public surface is `pair` only. */
export interface HistoryViews {
  readonly pair: TransformPair2D;
  setParity(index: number): void;
  dispose(): void;
}

/**
 * Four views over the two history buffers.
 * Float views use `core:transform-history-0` and `core:transform-history-1`.
 * Flag views use the same bytes under a second name, because one memory name
 * cannot be registered twice.
 * Returns undefined when either pointer is 0 or `parity` is not 0 or 1.
 */
export function installHistoryViews(
  memory: EngineMemory,
  maxEntities: number,
  readPtr: (buffer: number) => number,
  parity: number,
): HistoryViews | undefined {
  const ptr0 = readPtr(0);
  const ptr1 = readPtr(1);
  if (ptr0 === 0 || ptr1 === 0) return undefined;
  if (parity !== 0 && parity !== 1) return undefined;
  const floats = maxEntities * SLOT_FLOATS;
  const length = (): number => floats;
  const f0 = memory.view({
    name: "core:transform-history-0",
    type: "f32",
    ptr: () => ptr0,
    length,
  });
  const f1 = memory.view({
    name: "core:transform-history-1",
    type: "f32",
    ptr: () => ptr1,
    length,
  });
  const u0 = memory.view({
    name: "core:transform-history-0-flags",
    type: "u32",
    ptr: () => ptr0,
    length,
  });
  const u1 = memory.view({
    name: "core:transform-history-1-flags",
    type: "u32",
    ptr: () => ptr1,
    length,
  });
  let current: 0 | 1 = parity === 0 ? 0 : 1;
  const pair: TransformPair2D = {
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
