/**
 * Engine Serializer — binary serialization of ECS components to WASM.
 *
 * Handles serialization and deserialization of component data
 * between TypeScript and the Rust/WASM core via DataView.
 *
 * Uses a single reusable scratch buffer to avoid per-frame allocations.
 *
 * @internal Used exclusively by the Engine class.
 */

import {
  type ComponentDefinition,
  type ComponentSchema,
  computeSchemaLayout,
  type SchemaLayout,
} from '../schema';
import type { ComponentType } from '../types';
import type { ComponentFieldValue } from './engine-api';

export class EngineSerializer {
  /** Layout cache — computed once per component type, reused every frame. */
  private layouts = new Map<ComponentType, SchemaLayout<Record<string, ComponentFieldValue>>>();

  /** Scratch buffer for zero-alloc serialization. Grown on demand, never shrunk. */
  private scratchBuffer = new ArrayBuffer(1024);
  private scratchView = new DataView(this.scratchBuffer);

  // ── Layout ──────────────────────────────────────────────────────────────────

  /**
   * Get or compute the binary layout for a component definition.
   * Layouts are cached — subsequent calls for the same component are O(1).
   */
  getOrComputeLayout(
    def: ComponentDefinition<ComponentSchema>,
  ): SchemaLayout<Record<string, ComponentFieldValue>> {
    let layout = this.layouts.get(def.name);
    if (!layout) {
      layout = computeSchemaLayout<Record<string, ComponentFieldValue>>(def.schema);
      this.layouts.set(def.name, layout);
    }
    return layout;
  }

  /**
   * Expose the internal layout map for components that need direct access
   * (e.g. `_getOrComputeLayout` delegation in Engine).
   */
  getLayouts(): ReadonlyMap<ComponentType, SchemaLayout<Record<string, ComponentFieldValue>>> {
    return this.layouts;
  }

  // ── Serialize ───────────────────────────────────────────────────────────────

  /**
   * Serialize component data to a `Uint8Array` using its registered layout.
   *
   * The returned slice is valid only until the next call to `serialize()` —
   * it points into the internal scratch buffer. Copy it if you need persistence.
   *
   * @throws If the component has no registered layout (call `getOrComputeLayout` first).
   * @throws If the component schema is empty (`byteLength === 0`).
   */
  serialize(componentId: string, data: unknown): Uint8Array {
    const layout = this.layouts.get(componentId);

    if (!layout) {
      throw new Error(
        `[GWEN] Component "${componentId}" has no registered layout. ` +
          `Define it with defineComponent({ name: "${componentId}", schema: { ... } }).`,
      );
    }
    if (layout.byteLength === 0) {
      throw new Error(
        `[GWEN] Component "${componentId}" has empty schema (byteLength === 0). ` +
          `Pass the full ComponentDefinition (defineComponent) instead of a plain string.`,
      );
    }

    this._growIfNeeded(layout.byteLength);

    const bytesWritten = layout.serialize(
      data as Record<string, ComponentFieldValue>,
      this.scratchView,
    );
    return new Uint8Array(this.scratchBuffer, 0, bytesWritten);
  }

  // ── Deserialize ─────────────────────────────────────────────────────────────

  /**
   * Deserialize a raw `Uint8Array` from WASM into a typed component object.
   *
   * @throws If the component has no registered layout.
   * @throws If the component schema is empty.
   */
  deserialize(componentId: string, raw: Uint8Array): Record<string, ComponentFieldValue> {
    const layout = this.layouts.get(componentId);

    if (!layout) {
      throw new Error(`[GWEN] Cannot deserialize "${componentId}": layout missing.`);
    }
    if (layout.byteLength === 0) {
      throw new Error(`[GWEN] Component "${componentId}" has empty schema (byteLength === 0).`);
    }

    this._growIfNeeded(layout.byteLength);

    const localBuf = new Uint8Array(this.scratchBuffer, 0, layout.byteLength);
    localBuf.set(raw.subarray(0, layout.byteLength));
    return layout.deserialize(this.scratchView) as Record<string, ComponentFieldValue>;
  }

  // ── Internal ─────────────────────────────────────────────────────────────────

  private _growIfNeeded(requiredBytes: number): void {
    if (this.scratchBuffer.byteLength < requiredBytes) {
      this.scratchBuffer = new ArrayBuffer(requiredBytes);
      this.scratchView = new DataView(this.scratchBuffer);
    }
  }
}
