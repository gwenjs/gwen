/**
 * Spawn and delete notifications from a WASM bridge.
 * The bridge does not import the entity mirror. The engine binds one trace.
 */

export interface EntityTrace {
  allocated(index: number, generation: number): void;
  deallocated(index: number, generation: number): void;
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
