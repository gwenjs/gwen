import type { GwenEngineBase, GwenProvides, ServiceChangeEvent } from "@gwenjs/schema";
import { GwenContextError, GwenContextErrorCodes } from "../context-errors.js";
import { getCurrentScope } from "../scope-slot.js";

function readProvided<K extends keyof GwenProvides>(
  engine: GwenEngineBase,
  key: K,
): GwenProvides[K] | undefined {
  // The registry keys the store by string; the key type K proves the value type.
  return engine.tryInject(key) as GwenProvides[K] | undefined;
}

/** Subscribe inside `setup`. The same value calls once. Removal calls `onChange(undefined)`. */
export function watchService<K extends keyof GwenProvides>(
  key: K,
  onChange: (value: GwenProvides[K] | undefined) => void,
): () => void {
  const scope = getCurrentScope();
  if (scope === null) {
    throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT, "watchService");
  }
  const engine = scope.engine;
  let seen = false;
  let current: GwenProvides[K] | undefined;
  const deliver = (value: GwenProvides[K] | undefined): void => {
    if (seen && value === current) return;
    seen = true;
    current = value;
    onChange(value);
  };
  const onProvided = (event: ServiceChangeEvent): void => {
    if (event.key !== key) return;
    deliver(readProvided(engine, key));
  };
  const onRemoved = (event: ServiceChangeEvent): void => {
    if (event.key !== key) return;
    deliver(readProvided(engine, key));
  };
  engine.hooks.hook("service:provided", onProvided);
  engine.hooks.hook("service:removed", onRemoved);
  deliver(readProvided(engine, key));
  let active = true;
  const dispose = (): void => {
    if (!active) return;
    active = false;
    engine.hooks.removeHook("service:provided", onProvided);
    engine.hooks.removeHook("service:removed", onRemoved);
  };
  scope.onCleanup(dispose);
  return dispose;
}

/** Live read. Each access calls `tryInject`. Nothing is cached. */
export function optionalService<K extends keyof GwenProvides>(
  engine: GwenEngineBase,
  key: K,
): { readonly current: GwenProvides[K] | undefined } {
  return {
    get current(): GwenProvides[K] | undefined {
      return readProvided(engine, key);
    },
  };
}
