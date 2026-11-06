import type { GwenErrorBusBase } from "@gwenjs/schema";

/**
 * Contributions an extension registers with a base, in registration order.
 * Created per engine inside the base's `setup`. Reads no ambient context.
 */
export interface ExtensionRegistry<T> {
  /** Adds `item` for `owner`. The disposer is idempotent. */
  register(owner: string, item: T): () => void;
  readonly size: number;
  /** Visits live items in registration order. No allocation per call. */
  forEach(fn: (item: T, owner: string) => void): void;
  /**
   * Calls `fn` per live item. A throw is caught, emitted once on `errors`,
   * and that registration is disposed. Later items still run.
   */
  invokeEach(
    errors: GwenErrorBusBase,
    failureCode: `${string}:${string}`,
    fn: (item: T, owner: string) => void,
  ): void;
}

interface Slot<T> {
  owner: string;
  item: T;
  live: boolean;
}

/**
 * One registry. Slots stay in registration order. A dispose during a pass
 * tombstones the slot; compaction runs after the outermost pass.
 */
export function createExtensionRegistry<T>(opts: { readonly name: string }): ExtensionRegistry<T> {
  const name = opts.name;
  const slots: Slot<T>[] = [];
  let liveCount = 0;
  let depth = 0;

  function compact(): void {
    let write = 0;
    for (let read = 0; read < slots.length; read += 1) {
      const slot = slots[read];
      if (slot !== undefined && slot.live) {
        slots[write] = slot;
        write += 1;
      }
    }
    slots.length = write;
  }

  function disposeSlot(slot: Slot<T>): void {
    if (!slot.live) return;
    slot.live = false;
    liveCount -= 1;
    if (depth === 0) compact();
  }

  return {
    register(owner, item) {
      const slot: Slot<T> = { owner, item, live: true };
      slots.push(slot);
      liveCount += 1;
      return () => {
        disposeSlot(slot);
      };
    },
    get size() {
      return liveCount;
    },
    forEach(fn) {
      const lengthAtStart = slots.length;
      depth += 1;
      try {
        for (let index = 0; index < lengthAtStart; index += 1) {
          const slot = slots[index];
          if (slot === undefined || !slot.live) continue;
          fn(slot.item, slot.owner);
        }
      } finally {
        depth -= 1;
        if (depth === 0) compact();
      }
    },
    invokeEach(errors, failureCode, fn) {
      const lengthAtStart = slots.length;
      depth += 1;
      try {
        for (let index = 0; index < lengthAtStart; index += 1) {
          const slot = slots[index];
          if (slot === undefined || !slot.live) continue;
          try {
            fn(slot.item, slot.owner);
          } catch (error: unknown) {
            disposeSlot(slot);
            errors.emit({
              level: "error",
              code: failureCode,
              message: `Registration of "${slot.owner}" in extension registry "${name}" threw and was disposed.`,
              error,
              source: name,
              target: { kind: "plugin", id: slot.owner, name: slot.owner },
            });
          }
        }
      } finally {
        depth -= 1;
        if (depth === 0) compact();
      }
    },
  };
}
