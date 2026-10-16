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

import type { ComponentSchema, SchemaType } from "../schema";
import type { ComponentType } from "../types";
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
        `Component layout invalid: ${String(unexpected)}`,
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
        `Component layout invalid: ${key}`,
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
  /** Used only while the bridge has no WASM engine. Each registry has its own counter. */
  private nextLocalId = 0;

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
}
