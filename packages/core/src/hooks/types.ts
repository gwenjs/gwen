/**
 * @file GWEN Hooks System — Complete type definitions
 *
 * Defines all hooks available in the GWEN engine using @unjs/hookable.
 * Provides full type safety for engine lifecycle, plugins, entities, and components.
 */

import type { GwenHooks as SchemaGwenHooks } from '@gwenjs/schema';

export type EngineLifecycleHooks = import('@gwenjs/schema').EngineLifecycleHooks;
export type PluginLifecycleHooks = import('@gwenjs/schema').PluginLifecycleHooks<any, any>;
export type EntityLifecycleHooks = import('@gwenjs/schema').EntityLifecycleHooks<
  import('../types').EntityId
>;
export type ComponentLifecycleHooks = import('@gwenjs/schema').ComponentLifecycleHooks<
  import('../types').EntityId
>;

/** Engine-core concrete hooks map used by Hookable. */
export interface GwenHooks extends SchemaGwenHooks<
  import('../types').EntityId,
  any,
  any,
  unknown
> {}
