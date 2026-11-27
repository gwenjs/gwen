/**
 * @file Install tracking behind hot-replacing a layout. Dev only: `defineLayout` and `useLayout`
 * write it under `__GWEN_DEV__`, so a production build tracks nothing.
 *
 * @module
 */

import { createDisposable } from "../disposable.js";
import type { LayoutDefinition, PlaceHandle } from "../actor/runtime/types.js";
import type { EntityId } from "../engine/engine-api";
import type { GwenEngine } from "../engine/engine-types.js";

/** Key of the {@link LayoutRecord} on a layout definition. */
export const HOT_LAYOUT: unique symbol = Symbol("gwen.hot.layout");

/** One `useLayout` handle of one engine. */
export interface LayoutInstall {
  readonly engine: GwenEngine;
  /** Entities the handle owns now: the ones its layout factory placed. */
  owned(): readonly EntityId[];
  /**
   * Dispose the handle and load it again with the factory its definition holds now.
   * @returns false when the handle was not loaded, or the load failed.
   */
  reload(): Promise<boolean>;
}

/** Every handle made from one layout, and the definition whose factory those handles read. */
export interface LayoutRecord<Refs extends Record<string, PlaceHandle<unknown>>> {
  readonly root: LayoutDefinition<Refs>;
  readonly installs: Set<LayoutInstall>;
  readonly engines: Set<GwenEngine>;
}

/** A layout definition in a dev build. */
export interface HotLayoutDefinition<
  Refs extends Record<string, PlaceHandle<unknown>>,
> extends LayoutDefinition<Refs> {
  readonly [HOT_LAYOUT]: LayoutRecord<Refs>;
}

function isHotLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  definition: LayoutDefinition<Refs>,
): definition is HotLayoutDefinition<Refs> {
  return HOT_LAYOUT in definition;
}

/** Handles of a layout. Undefined for a definition `defineLayout` did not make, or in a prod build. */
export function layoutRecordOf<Refs extends Record<string, PlaceHandle<unknown>>>(
  definition: LayoutDefinition<Refs>,
): LayoutRecord<Refs> | undefined {
  return isHotLayout(definition) ? definition[HOT_LAYOUT] : undefined;
}

/** Give a new layout definition its record. */
export function createLayoutRecord<Refs extends Record<string, PlaceHandle<unknown>>>(
  root: LayoutDefinition<Refs>,
): LayoutRecord<Refs> {
  return { root, installs: new Set(), engines: new Set() };
}

/** Record a handle on its layout. The engine drops it when it stops. */
export function trackLayout<Refs extends Record<string, PlaceHandle<unknown>>>(
  definition: LayoutDefinition<Refs>,
  engine: GwenEngine,
  install: Omit<LayoutInstall, "engine">,
): void {
  const record = layoutRecordOf(definition);
  if (record === undefined || engine.disposables.closed) return;
  if (!record.engines.has(engine)) {
    record.engines.add(engine);
    engine.disposables.add(
      "hot-layout",
      createDisposable(() => {
        record.engines.delete(engine);
        for (const install of record.installs) {
          if (install.engine === engine) record.installs.delete(install);
        }
      }),
    );
  }
  record.installs.add({ engine, ...install });
}
