/**
 * TypeScript copy of the Rust entity free list.
 * Deferred `createEntity` has to return the id WASM will hand out when the
 * queue runs, and that id is not exported. Every real WASM spawn or delete
 * notifies this mirror. A deferred op updates it at queue time and the later
 * WASM call only confirms.
 */

export class EntityIdMirror {
  private generations = new Uint32Array(0);
  private alive = new Uint8Array(0);
  private recordCount = 0;
  private slotCap = 0;
  private freeList = new Uint32Array(0);
  private freeCount = 0;
  private freeCap = 0;

  constructor(private readonly maxEntities: number) {}

  /** Next id, or null when every slot is live. Does not touch WASM. */
  tryAllocate(): { index: number; generation: number } | null {
    if (this.freeCount > 0) {
      this.freeCount -= 1;
      const index = this.freeList[this.freeCount] ?? 0;
      const generation = ((this.generations[index] ?? 0) + 1) >>> 0;
      this.generations[index] = generation;
      this.alive[index] = 1;
      return { index, generation };
    }
    if (this.recordCount >= this.maxEntities) return null;
    const index = this.recordCount;
    this.ensureSlot(index);
    this.generations[index] = 0;
    this.alive[index] = 1;
    this.recordCount += 1;
    return { index, generation: 0 };
  }

  /** A WASM spawn already happened. Ignore it when this slot was reserved. */
  noteAllocated(index: number, generation: number): void {
    if (this.isAlive(index, generation)) return;
    this.tryAllocate();
  }

  deallocate(index: number, generation: number): boolean {
    if (!this.isAlive(index, generation)) return false;
    this.alive[index] = 0;
    this.pushFree(index);
    return true;
  }

  noteDeallocated(index: number, generation: number): void {
    this.deallocate(index, generation);
  }

  isAlive(index: number, generation: number): boolean {
    if (index < 0 || index >= this.recordCount) return false;
    return this.alive[index] === 1 && this.generations[index] === generation;
  }

  private ensureSlot(index: number): void {
    if (index < this.slotCap) return;
    let next = this.slotCap === 0 ? 8 : this.slotCap;
    while (next <= index) next *= 2;
    const generations = new Uint32Array(next);
    const alive = new Uint8Array(next);
    if (this.slotCap > 0) {
      generations.set(this.generations);
      alive.set(this.alive);
    }
    this.generations = generations;
    this.alive = alive;
    this.slotCap = next;
  }

  private pushFree(index: number): void {
    if (this.freeCount === this.freeCap) {
      const next = this.freeCap === 0 ? 8 : this.freeCap * 2;
      const list = new Uint32Array(next);
      if (this.freeCap > 0) list.set(this.freeList);
      this.freeList = list;
      this.freeCap = next;
    }
    this.freeList[this.freeCount] = index;
    this.freeCount += 1;
  }
}
