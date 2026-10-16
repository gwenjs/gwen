/**
 * Engine Component Registry — TypeScript ↔ Rust component type ID mapping.
 *
 * Every ECS component type has a string name on the TS side (e.g. `'Transform'`)
 * and a numeric ID on the Rust side (assigned by `register_component`).
 *
 * This registry owns the bidirectional mapping and provides helpers to:
 * - Register a new type (lazy — on first use)
 * - Look up the numeric ID for a type name
 * - Collect all type IDs currently attached to an entity
 *
 * @internal Used exclusively by the Engine class.
 */

import { GwenError } from "@gwenjs/schema";

import type { ComponentSchema, SchemaType } from "../schema";
import type { ComponentType } from "../types";
import { unpackEntityId, type EntityId } from "./engine-api";
import type { GwenEngine } from "./engine-types";
import { createEngineLocal } from "./engine-local";
import { CoreErrorCodes } from "./engine-errors";
import type { WasmBridge } from "./wasm-bridge";

/** Rust bit cap. Every slot is a user name. */
const MAX_COMPONENT_TYPES = 128;

const registries = createEngineLocal((engine: GwenEngine) => {
  const bridge = engine.tryInject("wasm:bridge");
  if (!bridge) {
    throw new GwenError(
      CoreErrorCodes.WASM_NOT_INITIALIZED,
      "[GWEN] Component registry requires the engine wasm:bridge service.",
    );
  }
  return new EngineComponentRegistry(bridge);
});

export function componentRegistryFor(engine: GwenEngine): EngineComponentRegistry {
  return registries.get(engine);
}

export function componentTypeIds(engine: GwenEngine): ReadonlyMap<ComponentType, number> {
  return registries.peek(engine)?.getAll() ?? new Map();
}

/** One f32 lane. Names still reach the registry until the engine passes definitions. */
const NAME_LANES = Uint8Array.of(0);

function laneParts(type: SchemaType["type"]): readonly number[] {
  switch (type) {
    case "f32":
      return [0];
    case "f64":
      return [1];
    case "i32":
      return [2];
    case "u32":
      return [3];
    case "bool":
      return [4];
    case "i64":
      return [5];
    case "u64":
      return [6];
    case "string":
      return [7];
    case "vec2":
      return [0, 0];
    case "vec3":
      return [0, 0, 0];
    case "vec4":
    case "quat":
    case "color":
      return [0, 0, 0, 0];
    default: {
      const unexpected: never = type;
      throw new GwenError(
        CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
        `Component layout invalid: ${String(unexpected)}`,
      );
    }
  }
}

function lanesFromSchema(schema: ComponentSchema): Uint8Array {
  const lanes: number[] = [];
  for (const key of Object.keys(schema)) {
    const field = schema[key];
    if (!field) {
      throw new GwenError(
        CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
        `Component layout invalid: ${key}`,
      );
    }
    lanes.push(...laneParts(field.type));
  }
  return Uint8Array.from(lanes);
}

function sameLanes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

export interface ComponentLayoutSource {
  readonly name: string;
  readonly schema: ComponentSchema;
}

export class EngineComponentRegistry {
  /** TS component name → Rust numeric typeId */
  private typeIds = new Map<ComponentType, number>();
  /** Lane bytes stored with the name. A second layout must match. */
  private layouts = new Map<string, Uint8Array>();
  /** Used only while the bridge has no WASM engine. Each registry has its own counter. */
  private nextLocalId = 0;

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
   * Get the Rust typeId for a component name or a definition.
   * A string is one f32 lane. A definition uses its schema, in field order.
   * The same name with different lanes throws and stores nothing.
   *
   * @throws {GwenError} code `CORE:COMPONENT_TYPE_LIMIT_REACHED` when this name
   *   would be the 129th user type. The check runs before `registerComponent`.
   * @throws {GwenError} code `CORE:COMPONENT_LAYOUT_INVALID` when this name is
   *   already stored with different lanes.
   */
  getOrRegister(type: ComponentType): number;
  getOrRegister(def: ComponentLayoutSource): number;
  getOrRegister(typeOrDef: ComponentType | ComponentLayoutSource): number {
    const name = typeof typeOrDef === "string" ? typeOrDef : typeOrDef.name;
    const lanes = typeof typeOrDef === "string" ? NAME_LANES : lanesFromSchema(typeOrDef.schema);
    const existing = this.typeIds.get(name);
    const stored = this.layouts.get(name);
    if (existing !== undefined && stored !== undefined) {
      if (!sameLanes(stored, lanes)) {
        throw new GwenError(
          CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
          `Component layout invalid: ${name}`,
        );
      }
      return existing;
    }
    if (this.typeIds.size >= MAX_COMPONENT_TYPES) {
      throw new GwenError(
        CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED,
        `Component type limit reached: ${MAX_COMPONENT_TYPES} user types fit.`,
      );
    }
    // Same name, including an HMR swap, keeps this id. A second call does not
    // ask WASM again. Baked numeric ids are disabled; a hotter cache is #66.
    const bridgeActive =
      typeof this.wasmBridge.isActive === "function" && this.wasmBridge.isActive();
    const typeId = bridgeActive ? this.wasmBridge.registerComponent(lanes) : this.nextLocalId++;
    this.typeIds.set(name, typeId);
    this.layouts.set(name, lanes.slice());
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
