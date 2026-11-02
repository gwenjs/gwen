/**
 * Engine Component Registry — TypeScript ↔ Rust component type ID mapping.
 *
 * Every ECS component type has a string name on the TS side (e.g. `'Transform'`)
 * and a numeric ID on the Rust side (assigned by `register_component`).
 *
 * This registry owns the name-to-id mapping:
 * - Register a new type (lazy — on first use)
 * - Look up the numeric ID for a type name
 *
 * @internal Used exclusively by the Engine class.
 */

import { GwenError } from "@gwenjs/schema";

import { GwenScope } from "../context/scope";
import type { ComponentSchema, SchemaType } from "../schema";
import type { ComponentType } from "../types";
import type { GwenEngine } from "./engine-types";
import { createEngineLocal } from "./engine-local";
import { CoreErrorCodes, GwenComponentLimitError, GwenWasmError } from "./engine-errors";
import type { WasmBridge } from "./wasm-bridge";

/** Rust bit cap. Every slot is a user name. */
export const MAX_COMPONENT_TYPES = 128;

function currentPluginName(): string | null {
  for (let scope = GwenScope.current(); scope !== null; scope = scope.parent) {
    if (scope.meta.type === "plugin") return scope.meta.name ?? null;
  }
  return null;
}

function isWasmCode(error: unknown, code: string): error is GwenWasmError {
  return error instanceof GwenWasmError && error.code === code;
}

function throwTypeLimit(component: string, used: number, cause?: unknown): never {
  const owner = currentPluginName();
  throw new GwenComponentLimitError({
    component,
    owner,
    max: MAX_COMPONENT_TYPES,
    used,
    ...(cause !== undefined ? { cause } : {}),
  });
}

const registries = createEngineLocal((engine: GwenEngine) => {
  const bridge = engine.tryInject("wasm:bridge");
  if (!bridge) {
    throw new GwenError(
      CoreErrorCodes.WASM_NOT_INITIALIZED,
      "Component registry requires the engine wasm:bridge service.",
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

const LANE_F32 = [0];
const LANE_F64 = [1];
const LANE_I32 = [2];
const LANE_U32 = [3];
const LANE_BOOL = [4];
const LANE_I64 = [5];
const LANE_U64 = [6];
const LANE_STRING = [7];
const LANE_VEC2 = [0, 0];
const LANE_VEC3 = [0, 0, 0];
const LANE_VEC4 = [0, 0, 0, 0];

/** Same schema object, same lane bytes. A hot add must not build a new array. */
const schemaLanes = new WeakMap<ComponentSchema, Uint8Array>();

function laneParts(type: SchemaType["type"]): readonly number[] {
  switch (type) {
    case "f32":
      return LANE_F32;
    case "f64":
      return LANE_F64;
    case "i32":
      return LANE_I32;
    case "u32":
      return LANE_U32;
    case "bool":
      return LANE_BOOL;
    case "i64":
      return LANE_I64;
    case "u64":
      return LANE_U64;
    case "string":
      return LANE_STRING;
    case "vec2":
      return LANE_VEC2;
    case "vec3":
      return LANE_VEC3;
    case "vec4":
    case "quat":
    case "color":
      return LANE_VEC4;
    default: {
      const unexpected: never = type;
      throw new GwenError(
        CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
        `Component layout invalid: ${String(unexpected)}.`,
      );
    }
  }
}

function lanesFromSchema(schema: ComponentSchema): Uint8Array {
  const cached = schemaLanes.get(schema);
  if (cached !== undefined) return cached;
  const lanes: number[] = [];
  for (const key of Object.keys(schema)) {
    const field = schema[key];
    if (!field) {
      throw new GwenError(
        CoreErrorCodes.COMPONENT_LAYOUT_INVALID,
        `Component layout invalid: ${key}.`,
      );
    }
    const parts = laneParts(field.type);
    for (let index = 0; index < parts.length; index += 1) lanes.push(parts[index]!);
  }
  const bytes = Uint8Array.from(lanes);
  schemaLanes.set(schema, bytes);
  return bytes;
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
  /** Plugin that first registered the name, or null outside a plugin scope. */
  private owners = new Map<ComponentType, string | null>();
  /** Used only while the bridge has no WASM engine. Each registry has its own counter. */
  private nextLocalId = 0;

  constructor(private readonly wasmBridge: WasmBridge) {}

  // ── Registration ─────────────────────────────────────────────────────────────

  /**
   * Get the Rust typeId for a component name or a definition.
   * A string is one f32 lane. A definition uses its schema, in field order.
   * The same name with different lanes throws and stores nothing.
   *
   * @throws {GwenComponentLimitError} code `CORE:COMPONENT_TYPE_LIMIT_REACHED`
   *   when this name would be the 129th user type. The count is checked before
   *   `registerComponent`. A `GwenWasmError` with that code is rethrown as
   *   `GwenComponentLimitError` with `cause` set.
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
          `Component layout invalid: ${name}.`,
        );
      }
      return existing;
    }
    if (this.typeIds.size >= MAX_COMPONENT_TYPES) {
      throwTypeLimit(name, this.typeIds.size);
    }
    // Same name, including an HMR swap, keeps this id until `unuse` releases a
    // type its plugin owned. A second call does not ask WASM again. Baked
    // numeric ids are disabled; a hotter cache is #66.
    let typeId: number;
    if (this.bridgeActive()) {
      try {
        typeId = this.wasmBridge.registerComponent(lanes);
      } catch (error: unknown) {
        if (isWasmCode(error, CoreErrorCodes.COMPONENT_TYPE_LIMIT_REACHED)) {
          throwTypeLimit(name, MAX_COMPONENT_TYPES, error);
        }
        throw error;
      }
    } else {
      typeId = this.nextLocalId++;
    }
    this.typeIds.set(name, typeId);
    this.layouts.set(name, lanes.slice());
    this.owners.set(name, currentPluginName());
    return typeId;
  }

  /** Names stored on this engine. */
  usedCount(): number {
    return this.typeIds.size;
  }

  /**
   * Drop one name. `false` when the name is unknown, a row still holds it,
   * or a live query references it.
   * An inactive bridge frees the local id and does not call WASM.
   */
  release(type: ComponentType): boolean {
    const id = this.typeIds.get(type);
    if (id === undefined) return false;
    if (!this.bridgeActive()) {
      this.forget(type);
      return true;
    }
    try {
      this.wasmBridge.releaseComponent(id);
    } catch (error: unknown) {
      if (isWasmCode(error, CoreErrorCodes.COMPONENT_TYPE_IN_USE)) return false;
      throw error;
    }
    this.forget(type);
    return true;
  }

  /** Names first registered by `plugin` that had no live row or live query. */
  releaseOwnedBy(plugin: string): ComponentType[] {
    const names: ComponentType[] = [];
    for (const [type, owner] of this.owners) {
      if (owner === plugin) names.push(type);
    }
    const released: ComponentType[] = [];
    for (const type of names) {
      if (this.release(type)) released.push(type);
    }
    return released;
  }

  private bridgeActive(): boolean {
    return typeof this.wasmBridge.isActive === "function" && this.wasmBridge.isActive();
  }

  private forget(type: ComponentType): void {
    this.typeIds.delete(type);
    this.layouts.delete(type);
    this.owners.delete(type);
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
}
