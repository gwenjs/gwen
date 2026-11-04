import { GwenPluginNotFoundError } from "./engine-errors.js";
import type { GwenProvides } from "./engine-types.js";

/** Result of storing one service value. `same` and `engine-owned` are not announced. */
export type ServiceWriteResult =
  | { readonly kind: "same" }
  | { readonly kind: "engine-owned" }
  | { readonly kind: "created" }
  | { readonly kind: "overwrite"; readonly previous: unknown };

/**
 * `write` calls `assertState` before it stores.
 * `onDirectWrite` runs only for a direct `provide` that created or replaced a key.
 */
export interface ServiceContainerDeps {
  assertState: (method: string) => void;
  onDirectWrite?: (
    key: keyof GwenProvides,
    value: GwenProvides[keyof GwenProvides],
    write: ServiceWriteResult,
  ) => void;
}

function readProvidedService<K extends keyof GwenProvides>(
  services: ReadonlyMap<string, unknown>,
  key: K,
): GwenProvides[K] {
  return services.get(key) as GwenProvides[K]; // boundary: the map holds one value type for every key, and the key type K selects the member that provide stored under it
}

/** Keys the engine provides for itself. `delete` never removes them. */
const ENGINE_OWNED = new Set<string>(["wasm:bridge", "logger", "errors", "memory"]);

/**
 * Typed service map for provide, inject, and tryInject.
 * @internal
 */
export class ServiceContainer {
  private readonly _services = new Map<string, unknown>();

  constructor(private readonly deps: ServiceContainerDeps) {}

  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): ServiceWriteResult {
    const write = this.write(key, value);
    if (write.kind === "created" || write.kind === "overwrite") {
      this.deps.onDirectWrite?.(key, value, write);
    }
    return write;
  }

  // Widened: `write`, `has` and `delete` take `string` and `unknown`, so the compiler no longer
  // links a key to its `GwenProvides` value here; the engine collaborators call them with plain strings.
  /**
   * Same state gate as {@link provide}. Does not announce.
   * An equal value (`===`) is `same` and is not stored again.
   */
  write(key: string, value: unknown): ServiceWriteResult {
    this.deps.assertState("provide");
    if (this._services.has(key) && this._services.get(key) === value) {
      return { kind: "same" };
    }
    if (ENGINE_OWNED.has(key)) {
      this._services.set(key, value);
      return { kind: "engine-owned" };
    }
    const had = this._services.has(key);
    const previous = this._services.get(key);
    this._services.set(key, value);
    if (had) return { kind: "overwrite", previous };
    return { kind: "created" };
  }

  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K] {
    if (!this._services.has(key)) {
      throw new GwenPluginNotFoundError({
        pluginName: String(key),
        composable: "engine.inject",
        what: `No plugin provides service "${String(key)}".`,
        hint: __GWEN_DEV__
          ? `Install a plugin that declares provides: ["${String(key)}"].`
          : undefined,
      });
    }
    return readProvidedService(this._services, key);
  }

  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined {
    if (!this._services.has(key)) return undefined;
    return readProvidedService(this._services, key);
  }

  has(key: string): boolean {
    return this._services.has(key);
  }

  /**
   * Drop `key` when the map still holds `expected`.
   * Does not call `assertState`: `stop()` from `faulted` still removes services.
   */
  delete(key: string, expected: unknown): boolean {
    if (ENGINE_OWNED.has(key)) return false;
    if (this._services.get(key) !== expected) return false;
    this._services.delete(key);
    return true;
  }
}
