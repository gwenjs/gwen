/**
 * @file What a plugin swap reads from the plugin registry of one engine. Dev only: the engine
 * writes it in its `__GWEN_DEV__` block.
 *
 * @module
 */

import type { GwenEngine, GwenPlugin } from "../engine/engine-types.js";

/** Read access to the registry of one engine. */
export interface PluginHost {
  /** The installed plugin object, or undefined. */
  named(name: string): GwenPlugin | undefined;
  /** Installed plugins that still require `name` or one of its services. */
  dependents(name: string): string[];
  /** Service keys the plugin `name` provided. */
  ownedKeys(name: string): string[];
}

const hosts = new WeakMap<GwenEngine, PluginHost>();

/** Remember the registry access of `engine`. */
export function rememberPluginHost(engine: GwenEngine, host: PluginHost): void {
  hosts.set(engine, host);
}

/** Registry access of `engine`. Undefined for an object that is not a GWEN engine. */
export function pluginHostOf(engine: GwenEngine): PluginHost | undefined {
  return hosts.get(engine);
}
