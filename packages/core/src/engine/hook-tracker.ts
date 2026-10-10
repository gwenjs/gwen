import type { Hookable } from "hookable";
import type { GwenRuntimeHooks } from "./runtime-hooks.js";

/**
 * Records (event, fn) pairs per plugin so they can be bulk-removed
 * when a plugin is unregistered.
 * @internal
 */
export class ScopedHooksTracker {
  private _map = new Map<string, Array<{ event: string; fn: (...args: unknown[]) => unknown }>>();

  track(pluginName: string, event: string, fn: (...args: unknown[]) => unknown): void {
    let bucket = this._map.get(pluginName);
    if (!bucket) {
      bucket = [];
      this._map.set(pluginName, bucket);
    }
    bucket.push({ event, fn });
  }

  removeAll(pluginName: string, hooks: Hookable<GwenRuntimeHooks>): void {
    const entries = this._map.get(pluginName);
    if (!entries) return;
    for (const { event, fn } of entries) {
      hooks.removeHook(event as keyof GwenRuntimeHooks, fn as never);
    }
    this._map.delete(pluginName);
  }

  clearAll(hooks: Hookable<GwenRuntimeHooks>): void {
    for (const pluginName of this._map.keys()) {
      this.removeAll(pluginName, hooks);
    }
  }
}
