/**
 * @file Install tracking behind hot-swapping a system. Dev only: `defineSystem` builds the
 * record and the control under `__GWEN_DEV__`, so a production build allocates neither. It still
 * creates three small helper closures per instance (`track`, `untrack`, `dropIsolation`) that
 * nothing calls.
 *
 * @module
 */

import type { GwenErrorTarget } from "@gwenjs/schema";
import { createEngineLocal } from "../engine/engine-local.js";
import type { GwenEngine } from "../engine/engine-types.js";
import type { HookSlots, ScopedHookable } from "../hooks/scoped-hookable.js";
import type { DiscoverablePlugin } from "../system/runtime/define-system";

/** Key of the {@link DefinitionRecord} on a `defineSystem` factory. */
export const HOT_RECORD: unique symbol = Symbol("gwen.hot.record");

/** Key of the {@link HotControl} on a plugin a `defineSystem` factory produced. */
export const HOT_CONTROL: unique symbol = Symbol("gwen.hot.control");

/** What a swapped-out system instance leaves for its replacement. */
export interface RetiredSystem {
  /** Bus slots of the old scope, in registration order per hook name. */
  readonly slots: HookSlots;
  /** True when the old scope was paused (user or scene pause). */
  paused: boolean;
  /** Scope id of the old install. The replacement keeps it, so its timing record stays. */
  readonly id: string | undefined;
}

/** Outcome of running a replacement's setup in place of the old body. */
export type RebuildResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: unknown; readonly target: GwenErrorTarget };

/** Hooks a `defineSystem` instance gives the swap. They act on closure state nobody else sees. */
export interface HotControl {
  /** Drop the old scope's hooks, cleanups and isolation entry, and return what to re-use. */
  retire(): RetiredSystem;
  /**
   * Run this instance's setup on the slots of `from`, under the active engine context.
   * A throw leaves the slots parked for the next swap and is returned, not thrown.
   */
  rebuild(from: RetiredSystem, root: HotControl): RebuildResult;
  /** Make the plugin the engine holds answer through `to` from now on. */
  redirect(to: DiscoverablePlugin): void;
}

/** One live (or failed) install of a `defineSystem` factory on one engine. */
export interface SystemInstall<Args extends unknown[]> {
  /** Scope id of the install, `system#<n>`. */
  readonly id: string;
  readonly engine: GwenEngine;
  /** The arguments the install was built with. A swap builds the new body from them. */
  readonly args: Args;
  readonly control: HotControl;
  /** Control of the first plugin of the chain: the one the engine and the handle hold. */
  readonly root: HotControl;
}

/** Every install of one `defineSystem` factory. */
export class DefinitionRecord<Args extends unknown[]> {
  readonly installs = new Set<SystemInstall<Args>>();

  constructor(readonly name: string) {}
}

/** A `defineSystem` factory in a dev build. */
export interface HotFactory<Args extends unknown[]> {
  (...args: Args): DiscoverablePlugin;
  readonly [HOT_RECORD]: DefinitionRecord<Args>;
}

/** A plugin a `defineSystem` factory produced in a dev build. */
export interface HotPlugin extends DiscoverablePlugin {
  readonly [HOT_CONTROL]: HotControl;
}

function isHotFactory<Args extends unknown[]>(
  factory: (...args: Args) => DiscoverablePlugin,
): factory is HotFactory<Args> {
  return HOT_RECORD in factory;
}

function isHotPlugin(plugin: DiscoverablePlugin): plugin is HotPlugin {
  return HOT_CONTROL in plugin;
}

/** Installs of a factory. Undefined for a factory `defineSystem` did not make, or in a prod build. */
export function recordOf<Args extends unknown[]>(
  factory: (...args: Args) => DiscoverablePlugin,
): DefinitionRecord<Args> | undefined {
  return isHotFactory(factory) ? factory[HOT_RECORD] : undefined;
}

/** Swap control of a plugin. Undefined for a plugin `defineSystem` did not make. */
export function controlOf(plugin: DiscoverablePlugin): HotControl | undefined {
  return isHotPlugin(plugin) ? plugin[HOT_CONTROL] : undefined;
}

/** What one engine knows of one installed system. `scope` supplies phases and pause. */
export interface SystemInstallInfo {
  /** Scope id. Phase lists hold this id. */
  readonly id: string;
  /** Display name passed to `defineSystem`. */
  readonly name: string;
  /** Live scope, or null when the install was recorded without one. */
  readonly scope: ScopedHookable | null;
}

/** Installed systems of one engine, by scope id. Released by `stop()`. */
export const systemInstalls = createEngineLocal<Map<string, SystemInstallInfo>>(() => new Map());
