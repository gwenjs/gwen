import { GwenPluginNotFoundError } from "./engine-errors.js";
import type { GwenProvides } from "./engine-types.js";

/**
 * `provide` calls this before it stores. The facade passes `_assertNotFaulted`.
 */
export interface ServiceContainerDeps {
  assertState: (method: string) => void;
}

// boundary: one map holds every GwenProvides value; the key selects its member.
function readProvidedService<K extends keyof GwenProvides>(
  services: ReadonlyMap<keyof GwenProvides, GwenProvides[keyof GwenProvides]>,
  key: K,
): GwenProvides[K] {
  return services.get(key) as GwenProvides[K];
}

/**
 * Typed service map for provide, inject, and tryInject.
 * @internal
 */
export class ServiceContainer {
  private readonly _services = new Map<keyof GwenProvides, GwenProvides[keyof GwenProvides]>();

  constructor(private readonly deps: ServiceContainerDeps) {}

  provide<K extends keyof GwenProvides>(key: K, value: GwenProvides[K]): void {
    this.deps.assertState("provide");
    this._services.set(key, value);
  }

  inject<K extends keyof GwenProvides>(key: K): GwenProvides[K] {
    if (!this._services.has(key)) {
      throw new GwenPluginNotFoundError({
        pluginName: String(key),
        hint: `Call engine.use(${String(key)}Plugin()) before using this service.`,
        docsUrl: "https://gwenengine.dev/docs/plugins",
      });
    }
    return readProvidedService(this._services, key);
  }

  tryInject<K extends keyof GwenProvides>(key: K): GwenProvides[K] | undefined {
    if (!this._services.has(key)) return undefined;
    return readProvidedService(this._services, key);
  }
}
