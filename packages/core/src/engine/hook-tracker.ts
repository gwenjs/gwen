/**
 * The one `Hookable` method the tracker calls. Plugin hook names are plain strings.
 * Widened: the method syntax is checked bivariantly, which is the only reason a
 * `Hookable<GwenRuntimeHooks>` is accepted where `removeHook` takes `string` and `unknown` arguments.
 */
interface HookRemover {
  removeHook(event: string, fn: (...args: unknown[]) => unknown): void;
}

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

  removeAll(pluginName: string, hooks: HookRemover): void {
    const entries = this._map.get(pluginName);
    if (!entries) return;
    for (const { event, fn } of entries) {
      hooks.removeHook(event, fn);
    }
    this._map.delete(pluginName);
  }

  clearAll(hooks: HookRemover): void {
    for (const pluginName of this._map.keys()) {
      this.removeAll(pluginName, hooks);
    }
  }
}
