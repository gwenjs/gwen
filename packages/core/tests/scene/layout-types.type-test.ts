/**
 * @file Type-test for layout types.
 *
 * Verifies that PlaceHandle, LayoutDefinition, LayoutHandle, and UseLayoutOptions
 * types are correctly structured and can be used with proper type narrowing.
 */

import type {
  PlaceHandle,
  LayoutDefinition,
  LayoutHandle,
  UseLayoutOptions,
} from '../../src/scene/types.js';

// PlaceHandle is generic on API
declare const handle: PlaceHandle<{ hp: number }>;
const _id: bigint = handle.entityId;
const _hp: number = handle.api.hp;
handle.moveTo([0, 0]);
handle.despawn();

// LayoutHandle has typed refs
declare const layout: LayoutHandle<{ player: PlaceHandle<void> }>;
const _active: boolean = layout.active;
layout.load();
layout.dispose();

// UseLayoutOptions is optional
declare const opts: UseLayoutOptions | undefined;
if (opts?.lazy !== undefined) {
  const _lazy: boolean = opts.lazy;
}

// LayoutDefinition has _factory and __layoutName__
declare const layoutDef: LayoutDefinition<{ player: PlaceHandle<void> }>;
const _factory = layoutDef._factory;
const _name: string = layoutDef.__layoutName__;
