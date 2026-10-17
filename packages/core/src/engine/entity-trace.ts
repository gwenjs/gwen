/**
 * Spawn and delete notifications from a WASM bridge.
 * The bridge does not import the entity mirror. The engine binds one trace.
 */

export interface EntityTrace {
  allocated(index: number, generation: number): void;
  deallocated(index: number, generation: number): void;
  /**
   * While a chunk loop is open, reserve the id WASM will hand out.
   * `undefined` means the bridge should call WASM now.
   */
  deferCreate?(): { index: number; generation: number } | undefined;
  /** `undefined` means the bridge should call WASM now. */
  deferDestroy?(index: number, generation: number): boolean | undefined;
  /** `undefined` means the bridge should call WASM now. */
  deferBulkSpawn?(positions: Float32Array, rotations: Float32Array): Uint32Array | undefined;
  /** `true` means the destroy was queued. `undefined` means call WASM. */
  deferBulkDestroy?(indices: Uint32Array): true | undefined;
}

const traces = new WeakMap<object, EntityTrace>();

export function bindEntityTrace(bridge: object, trace: EntityTrace): void {
  traces.set(bridge, trace);
}

export function hasEntityTrace(bridge: object): boolean {
  return traces.has(bridge);
}

export function noteEntityAllocated(bridge: object, index: number, generation: number): void {
  traces.get(bridge)?.allocated(index, generation);
}

export function noteEntityDeallocated(bridge: object, index: number, generation: number): void {
  traces.get(bridge)?.deallocated(index, generation);
}

export function deferEntityCreate(
  bridge: object,
): { index: number; generation: number } | undefined {
  return traces.get(bridge)?.deferCreate?.();
}

export function deferEntityDestroy(
  bridge: object,
  index: number,
  generation: number,
): boolean | undefined {
  return traces.get(bridge)?.deferDestroy?.(index, generation);
}

export function deferBulkSpawn(
  bridge: object,
  positions: Float32Array,
  rotations: Float32Array,
): Uint32Array | undefined {
  return traces.get(bridge)?.deferBulkSpawn?.(positions, rotations);
}

export function deferBulkDestroy(bridge: object, indices: Uint32Array): true | undefined {
  return traces.get(bridge)?.deferBulkDestroy?.(indices);
}
