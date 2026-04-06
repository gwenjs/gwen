/**
 * GWEN Component Schema DSL
 *
 * Defines the static data structure of ECS components.
 * This DSL serves two purposes:
 * 1. Runtime TypeScript validation and type inference.
 * 2. Build-time WASM memory layout generation (by @gwenjs/cli).
 *
 * @example
 * ```typescript
 * import { defineComponent, Types, InferComponent } from '@gwenjs/core';
 *
 * export const Health = defineComponent({
 *   name: 'Health',
 *   schema: {
 *     current: Types.f32,
 *     max: Types.f32,
 *     isAlive: Types.bool
 *   }
 * });
 *
 * // Automatically infers: { current: number, max: number, isAlive: boolean }
 * export type HealthType = InferComponent<typeof Health>;
 * ```
 */

// Supported scalar types for WASM memory layout
export const Types = {
  f32: {
    type: 'f32' as const,
    byteLength: 4,
    read: 'getFloat32' as const,
    write: 'setFloat32' as const,
  },
  f64: {
    type: 'f64' as const,
    byteLength: 8,
    read: 'getFloat64' as const,
    write: 'setFloat64' as const,
  },
  i32: {
    type: 'i32' as const,
    byteLength: 4,
    read: 'getInt32' as const,
    write: 'setInt32' as const,
  },
  i64: {
    type: 'i64' as const,
    byteLength: 8,
    read: 'getBigInt64' as const,
    write: 'setBigInt64' as const,
  },
  u32: {
    type: 'u32' as const,
    byteLength: 4,
    read: 'getUint32' as const,
    write: 'setUint32' as const,
  },
  u64: {
    type: 'u64' as const,
    byteLength: 8,
    read: 'getBigUint64' as const,
    write: 'setBigUint64' as const,
  },
  bool: {
    type: 'bool' as const,
    byteLength: 1,
    read: 'getInt8' as const,
    write: 'setInt8' as const,
  },
  string: {
    type: 'string' as const,
    byteLength: 4,
    read: 'getString' as const,
    write: 'setString' as const,
  },
  /**
   * Persistent string — survives scene transitions.
   *
   * **⚠️ Use sparingly!** Only for cross-scene data like:
   * - Player names from save files
   * - User preferences
   * - Configuration loaded once at startup
   *
   * Default to `Types.string` (scene-scoped) unless you explicitly need persistence.
   */
  persistentString: {
    type: 'string' as const,
    byteLength: 4,
    read: 'getString' as const,
    write: 'setString' as const,
    isPersistent: true, // Flag for computeSchemaLayout to select the persistent pool
  },

  // ── Spatial primitives ──────────────────────────────────────────────────────
  // Use these in components instead of declaring separate f32 fields.
  // Serialized as packed f32 arrays; read/write are intentionally absent
  // (handled by the schema serializer as packed f32 arrays).

  /** 2D vector — serialized as 2 × f32 (x, y). */
  vec2: { type: 'vec2' as const, byteLength: 8, fields: ['x', 'y'] as const },
  /** 3D vector — serialized as 3 × f32 (x, y, z). */
  vec3: { type: 'vec3' as const, byteLength: 12, fields: ['x', 'y', 'z'] as const },
  /** 4D vector — serialized as 4 × f32 (x, y, z, w). */
  vec4: { type: 'vec4' as const, byteLength: 16, fields: ['x', 'y', 'z', 'w'] as const },
  /** Quaternion — serialized as 4 × f32 (x, y, z, w). Identity: (0, 0, 0, 1). */
  quat: { type: 'quat' as const, byteLength: 16, fields: ['x', 'y', 'z', 'w'] as const },
  /** RGBA color — serialized as 4 × f32 (r, g, b, a). Range [0, 1] per channel. */
  color: { type: 'color' as const, byteLength: 16, fields: ['r', 'g', 'b', 'a'] as const },
};

export type SchemaType = (typeof Types)[keyof typeof Types];

export interface ComponentSchema {
  [field: string]: SchemaType;
}

export interface SchemaLayout<T> {
  byteLength: number;
  hasString: boolean;
  /**
   * Serialize `data` into `view` and return the total bytes written.
   * Always present — `computeSchemaLayout` unconditionally produces this function.
   */
  serialize: (data: T, view: DataView) => number;
  /**
   * Deserialize a component from `view` and return the typed value.
   * Always present — `computeSchemaLayout` unconditionally produces this function.
   */
  deserialize: (view: DataView) => T;
}

// ── Internal types for serialization ──────────────────────────────────────────

/** Possible JavaScript value for a schema field */
type FieldValue = number | bigint | boolean | string | Record<string, number>;

interface FieldMeta {
  type: SchemaType['type'];
  offset: number;
  byteLength: number;
}

/**
 * Handler for a specific schema type category.
 * Adding a new schema type only requires adding one entry here — no other code changes needed.
 */
interface SchemaTypeHandler {
  serialize(view: DataView, offset: number, value: unknown, typeObj: SchemaType): void;
  deserialize(
    view: DataView,
    offset: number,
    typeObj: SchemaType,
  ): FieldValue | Record<string, number>;
}

/**
 * Field names for each composite spatial type.
 *
 * Derived directly from `Types` to stay in sync automatically. Adding a new
 * composite type to `Types` is the single source of truth — no manual update here.
 */
const COMPOSITE_FIELDS: Record<string, readonly string[]> = Object.fromEntries(
  Object.values(Types)
    .filter(
      (t): t is Extract<(typeof Types)[keyof typeof Types], { fields: readonly string[] }> =>
        'fields' in t,
    )
    .map((t) => [t.type, t.fields]),
);

import { GlobalStringPoolManager } from './utils/string-pool.js';

// Typed helpers for dynamic DataView numeric read/write dispatch.
// Avoids `as any` on DataView for dynamic method name calls.
type DataViewWriter = (view: DataView, offset: number, value: number) => void;
type DataViewReader = (view: DataView, offset: number) => number;

const DATAVIEW_WRITERS: Record<string, DataViewWriter> = {
  setInt8: (v, o, x) => v.setInt8(o, x),
  setUint8: (v, o, x) => v.setUint8(o, x),
  setInt16: (v, o, x) => v.setInt16(o, x, true),
  setUint16: (v, o, x) => v.setUint16(o, x, true),
  setInt32: (v, o, x) => v.setInt32(o, x, true),
  setUint32: (v, o, x) => v.setUint32(o, x, true),
  setFloat32: (v, o, x) => v.setFloat32(o, x, true),
  setFloat64: (v, o, x) => v.setFloat64(o, x, true),
};

const DATAVIEW_READERS: Record<string, DataViewReader> = {
  getInt8: (v, o) => v.getInt8(o),
  getUint8: (v, o) => v.getUint8(o),
  getInt16: (v, o) => v.getInt16(o, true),
  getUint16: (v, o) => v.getUint16(o, true),
  getInt32: (v, o) => v.getInt32(o, true),
  getUint32: (v, o) => v.getUint32(o, true),
  getFloat32: (v, o) => v.getFloat32(o, true),
  getFloat64: (v, o) => v.getFloat64(o, true),
};

/**
 * Dispatch table mapping each schema type name to its serialize/deserialize handlers.
 * Defined once at module load — zero per-call allocation.
 *
 * The `_numeric` key is used as the fallback for f32, f64, i32, u32 (standard DataView types).
 */
const SCHEMA_TYPE_HANDLERS: Record<string, SchemaTypeHandler> = {
  bool: {
    serialize(view, offset, value) {
      view.setInt8(offset, value ? 1 : 0);
    },
    deserialize(view, offset) {
      return view.getInt8(offset) !== 0;
    },
  },

  string: {
    serialize(view, offset, value, typeObj) {
      const pool = (typeObj as SchemaType & { isPersistent?: boolean }).isPersistent
        ? GlobalStringPoolManager.persistent
        : GlobalStringPoolManager.scene;
      view.setInt32(offset, pool.intern(value as string), true);
    },
    deserialize(view, offset, typeObj) {
      const strId = view.getInt32(offset, true);
      const pool = (typeObj as SchemaType & { isPersistent?: boolean }).isPersistent
        ? GlobalStringPoolManager.persistent
        : GlobalStringPoolManager.scene;
      return pool.get(strId);
    },
  },

  i64: {
    serialize(view, offset, value) {
      view.setBigInt64(offset, BigInt(value as number), true);
    },
    deserialize(view, offset) {
      return view.getBigInt64(offset, true);
    },
  },

  u64: {
    serialize(view, offset, value) {
      view.setBigUint64(offset, BigInt(value as number), true);
    },
    deserialize(view, offset) {
      return view.getBigUint64(offset, true);
    },
  },

  // Composite spatial types share the same packed-f32 strategy.
  // Each is registered individually so the dispatch lookup is a direct key match.
  ...Object.fromEntries(
    Object.entries(COMPOSITE_FIELDS).map(([typeName, fields]) => [
      typeName,
      {
        serialize(view: DataView, offset: number, value: unknown) {
          const composite = value as Record<string, number>;
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (field !== undefined) {
              view.setFloat32(offset + i * 4, composite[field] ?? 0, true);
            }
          }
        },
        deserialize(view: DataView, offset: number) {
          const composite: Record<string, number> = {};
          for (let i = 0; i < fields.length; i++) {
            const field = fields[i];
            if (field !== undefined) {
              composite[field] = view.getFloat32(offset + i * 4, true);
            }
          }
          return composite;
        },
      } satisfies SchemaTypeHandler,
    ]),
  ),

  // Fallback for standard numeric types: f32, f64, i32, u32.
  // `Types[type].read` / `.write` hold the correct DataView method name.
  _numeric: {
    serialize(view, offset, value, typeObj) {
      const t = typeObj as { write: string };
      DATAVIEW_WRITERS[t.write]?.(view, offset, value as number);
    },
    deserialize(view, offset, typeObj) {
      const t = typeObj as { read: string };
      return DATAVIEW_READERS[t.read]?.(view, offset) ?? 0;
    },
  },
};

export function computeSchemaLayout<T extends Record<string, FieldValue>>(
  schema: ComponentSchema,
): Readonly<SchemaLayout<T>> {
  let offset = 0;
  const layout = new Map<string, FieldMeta>();

  for (const [key, typeObj] of Object.entries(schema)) {
    layout.set(key, { type: typeObj.type, offset, byteLength: typeObj.byteLength });
    offset += typeObj.byteLength;
  }

  const totalByteLength = offset;
  const order = Array.from(layout.entries());

  // Pre-resolve handlers per field so the hot per-frame loop does no map lookups.
  const handlers = order.map(([key, meta]) => ({
    key,
    meta,
    typeObj: schema[key]!,
    handler: (SCHEMA_TYPE_HANDLERS[meta.type] ?? SCHEMA_TYPE_HANDLERS['_numeric'])!,
  }));

  const serialize = (data: T, view: DataView): number => {
    let bytesWritten = 0;
    for (const { key, meta, typeObj, handler } of handlers) {
      handler.serialize(view, meta.offset, data[key as keyof T], typeObj);
      bytesWritten += meta.byteLength;
    }
    return bytesWritten;
  };

  const deserialize = (view: DataView): T => {
    const obj: Record<string, FieldValue | Record<string, number>> = {};
    for (const { key, meta, typeObj, handler } of handlers) {
      obj[key] = handler.deserialize(view, meta.offset, typeObj);
    }
    return obj as T;
  };

  return {
    byteLength: totalByteLength,
    hasString: order.some(([, m]) => m.type === 'string'),
    serialize,
    deserialize,
  };
}

/**
 * Maps a `SchemaType` to its corresponding TypeScript value type.
 *
 * - `bool` → `boolean`
 * - `string` → `string`
 * - `i64` / `u64` → `bigint`
 * - `vec2` → `{ x: number; y: number }`
 * - `vec3` → `{ x: number; y: number; z: number }`
 * - `vec4` / `quat` → `{ x: number; y: number; z: number; w: number }`
 * - `color` → `{ r: number; g: number; b: number; a: number }`
 * - all other numeric types → `number`
 */
export type InferSchemaType<T extends SchemaType> = T['type'] extends 'bool'
  ? boolean
  : T['type'] extends 'string'
    ? string
    : T['type'] extends 'i64' | 'u64'
      ? bigint
      : T['type'] extends 'vec2'
        ? { x: number; y: number }
        : T['type'] extends 'vec3'
          ? { x: number; y: number; z: number }
          : T['type'] extends 'vec4' | 'quat'
            ? { x: number; y: number; z: number; w: number }
            : T['type'] extends 'color'
              ? { r: number; g: number; b: number; a: number }
              : number;

/**
 * Extracts the TypeScript interface from a ComponentDefinition.
 */
export type InferComponent<D extends ComponentDefinition<ComponentSchema>> = {
  [K in keyof D['schema']]: InferSchemaType<D['schema'][K]>;
};

/** Monotonic counter for assigning unique numeric IDs to components at definition time. */
let _nextTypeId = 1;

/**
 * Definition of an ECS component with a typed schema and optional default values.
 *
 * @typeParam S - The component schema mapping field names to `SchemaType` descriptors.
 *
 * @example
 * ```ts
 * const Transform = defineComponent({
 *   name: 'Transform',
 *   schema: { position: Types.vec3, rotation: Types.quat },
 *   defaults: {
 *     position: { x: 0, y: 0, z: 0 },
 *     rotation: { x: 0, y: 0, z: 0, w: 1 },
 *   },
 * });
 * ```
 */
export interface ComponentDefinition<S extends ComponentSchema> {
  readonly name: string;
  readonly schema: S;
  /**
   * Optional default field values applied by `api.component.set()` when the
   * component does not yet exist on the entity (upsert behaviour).
   *
   * Defaults are merged left-to-right: `{ ...defaults, ...patch }`.
   */
  readonly defaults?: Partial<{ [K in keyof S]: InferSchemaType<S[K]> }>;
  /**
   * Unique numeric ID assigned at call time, used as the WASM `component_type_id`.
   * Matches the ID used in `register_component_type` on the Rust side.
   *
   * @internal Used by the gwen:optimizer Vite plugin — do not rely on the specific value.
   */
  readonly _typeId: number;
  /**
   * Total byte size of one component instance in the WASM linear memory layout.
   *
   * @internal
   */
  readonly _byteSize: number;
  /**
   * Number of Float32 slots per entity (`_byteSize / 4`).
   *
   * Only valid for schemas composed of f32-aligned fields (f32, i32, u32, f64, etc.).
   * Sub-word fields (`bool`, 1 byte) produce non-integer strides — the optimizer
   * skips components with fractional strides.
   *
   * @internal
   */
  readonly _f32Stride: number;
  /**
   * Ordered field descriptors matching WASM memory layout (same order as schema keys).
   *
   * @internal
   */
  readonly _fields: ReadonlyArray<{
    readonly name: string;
    readonly type: string;
    readonly byteOffset: number;
  }>;
}

/**
 * Body of a ComponentDefinition without the `name` or computed metadata fields — used by factory form.
 */
export type ComponentBody<S extends ComponentSchema> = Omit<
  ComponentDefinition<S>,
  'name' | '_typeId' | '_byteSize' | '_f32Stride' | '_fields'
>;

/**
 * Define an ECS component schema — two syntaxes supported.
 *
 * **Form 1 — direct object**:
 * ```ts
 * export const Position = defineComponent({
 *   name: 'position',
 *   schema: { x: Types.f32, y: Types.f32 },
 * });
 * ```
 *
 * **Form 2 — factory (required for dynamic schema)**:
 * ```ts
 * export const Position = defineComponent('position', () => ({
 *   schema: { x: Types.f32, y: Types.f32 },
 * }));
 * ```
 *
 * @param nameOrConfig Either a string name or a full ComponentDefinition
 * @param factory Optional factory function (required for Form 2)
 * @returns The component definition with schema and name
 *
 * @example
 * ```ts
 * export const Health = defineComponent({
 *   name: 'health',
 *   schema: { current: Types.f32, max: Types.f32 }
 * });
 * type HealthData = InferComponent<typeof Health>;
 * ```
 */
export function defineComponent<S extends ComponentSchema>(
  config: Omit<ComponentDefinition<S>, '_typeId' | '_byteSize' | '_f32Stride' | '_fields'>,
): ComponentDefinition<S>;

export function defineComponent<S extends ComponentSchema>(
  name: string,
  factory: () => ComponentBody<S>,
): ComponentDefinition<S>;

export function defineComponent<S extends ComponentSchema>(
  nameOrConfig:
    | string
    | Omit<ComponentDefinition<S>, '_typeId' | '_byteSize' | '_f32Stride' | '_fields'>,
  factory?: () => ComponentBody<S>,
): ComponentDefinition<S> {
  const config: Omit<
    ComponentDefinition<S>,
    '_typeId' | '_byteSize' | '_f32Stride' | '_fields'
  > = typeof nameOrConfig === 'string' ? { name: nameOrConfig, ...factory!() } : nameOrConfig;

  const _typeId = _nextTypeId++;

  let byteOffset = 0;
  const _fields = Object.entries(config.schema).map(([fieldName, schemaType]) => {
    const field = { name: fieldName, type: (schemaType as SchemaType).type, byteOffset };
    byteOffset += (schemaType as SchemaType).byteLength;
    return field;
  });

  const _byteSize = byteOffset;
  const _f32Stride = _byteSize / 4;

  return {
    ...config,
    _typeId,
    _byteSize,
    _f32Stride,
    _fields,
  } as ComponentDefinition<S>;
}
