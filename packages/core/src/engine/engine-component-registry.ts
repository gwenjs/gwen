/**
 * Engine Component Registry — TypeScript ↔ Rust component type ID mapping.
 *
 * Every ECS component type has a string name on the TS side (e.g. `'Transform'`)
 * and a numeric ID on the Rust side (assigned by `register_component_type()`).
 *
 * This registry owns the bidirectional mapping and provides helpers to:
 * - Register a new type (lazy — on first use)
 * - Look up the numeric ID for a type name
 * - Collect all type IDs currently attached to an entity
 *
 * @internal Used exclusively by the Engine class.
 */

import type { ComponentType } from '../types';
import type { WasmBridge } from './wasm-bridge';
import { unpackEntityId, type EntityId } from './engine-api';

export class EngineComponentRegistry {
  /** TS component name → Rust numeric typeId */
  private typeIds = new Map<ComponentType, number>();

  /**
   * TS-side cache of active typeIds per entity slot.
   *
   * Key: slot index (raw, not packed EntityId) — invariant with respect to generation.
   * Value: Set of typeIds attached to this slot.
   *
   * Invariant: this cache stays in sync with the WASM state via the internal
   * methods of `Engine` (`_addComponentInternal`, `_removeComponentInternal`,
   * `_destroyEntityInternal`).
   *
   * Eliminates O(N×M) WASM calls in getEntityTypeIds() — replaced by an O(1) read.
   */
  private entityTypeCache = new Map<number, Set<number>>();

  constructor(private readonly wasmBridge: WasmBridge) {}

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Get the Rust typeId for a component type name.
   * Registers a new ID with the WASM core if this is the first use.
   */
  getOrRegister(type: ComponentType): number {
    let typeId = this.typeIds.get(type);
    if (typeId === undefined) {
      typeId = this.wasmBridge.registerComponentType();
      this.typeIds.set(type, typeId);
    }
    return typeId;
  }

  /**
   * Get the Rust typeId for a component type name, or `undefined` if not yet registered.
   * Use this when you need to distinguish "not registered" from "registered with ID 0".
   */
  get(type: ComponentType): number | undefined {
    return this.typeIds.get(type);
  }

  /**
   * Read-only view of the full type map.
   * Exposed for shims and advanced introspection — do not mutate.
   */
  getAll(): ReadonlyMap<ComponentType, number> {
    return this.typeIds;
  }

  // ── Entity helpers ───────────────────────────────────────────────────────────

  /**
   * Track that a component type has been added to an entity slot.
   *
   * Maintains the entityTypeCache in sync with WASM state.
   * Called after `addComponent` succeeds on WASM.
   *
   * @param slotIndex Raw entity slot index (not packed EntityId)
   * @param typeId Rust component type ID
   */
  trackAdd(slotIndex: number, typeId: number): void {
    let types = this.entityTypeCache.get(slotIndex);
    if (!types) {
      types = new Set<number>();
      this.entityTypeCache.set(slotIndex, types);
    }
    types.add(typeId);
  }

  /**
   * Track that a component type has been removed from an entity slot.
   *
   * Maintains the entityTypeCache in sync with WASM state.
   * Called after `removeComponent` succeeds on WASM.
   *
   * @param slotIndex Raw entity slot index (not packed EntityId)
   * @param typeId Rust component type ID
   */
  trackRemove(slotIndex: number, typeId: number): void {
    const types = this.entityTypeCache.get(slotIndex);
    if (types) {
      types.delete(typeId);
      // Cleanup empty sets to avoid memory leak
      if (types.size === 0) {
        this.entityTypeCache.delete(slotIndex);
      }
    }
  }

  /**
   * Collect all Rust typeIds currently attached to an entity.
   *
   * Used to rebuild the archetype bitmask after add/remove operations.
   *
   * **Performance:** O(1) cache read instead of O(N×M) WASM calls.
   * The cache is maintained by trackAdd/trackRemove called from Engine.
   */
  getEntityTypeIds(id: EntityId): number[] {
    const { index } = unpackEntityId(id);
    const types = this.entityTypeCache.get(index);
    return types ? Array.from(types) : [];
  }

  /**
   * Clear the cache for a specific entity slot.
   * Called when an entity is destroyed to prevent memory leaks.
   *
   * @param slotIndex Raw entity slot index (not packed EntityId)
   */
  clearEntityCache(slotIndex: number): void {
    this.entityTypeCache.delete(slotIndex);
  }
}
