/**
 * Dev warning when an engine is collected without `stop()`.
 * Construction and the warning text live only under `__GWEN_DEV__`.
 * Prod builds drop that branch. This module is not a public export.
 */

interface LeakRegistry {
  register(target: object, heldValue: string, unregisterToken: object): void;
  unregister(unregisterToken: object): void;
}

interface LeakRegistryConstructor {
  new (callback: (heldValue: string) => void): LeakRegistry;
}

function isLeakRegistryConstructor(value: unknown): value is LeakRegistryConstructor {
  return typeof value === "function";
}

/** Shared token for the prod no-op. It is never registered. */
const idleToken: object = {};

let leakRegistry: LeakRegistry | undefined;
let leakSerial = 0;

/** First dev call builds the registry. Prod leaves it unset. */
function devRegistry(): LeakRegistry | undefined {
  if (__GWEN_DEV__) {
    if (leakRegistry === undefined) {
      const ctor: unknown = Reflect.get(globalThis, "FinalizationRegistry");
      if (isLeakRegistryConstructor(ctor)) {
        leakRegistry = new ctor((label: string) => {
          console.warn(
            `[GWEN] engine "${label}" was garbage-collected without stop(); call engine.stop() to release its WASM instance.`,
          );
        });
      }
    }
  }
  return leakRegistry;
}

/**
 * Register `target`. The held value is the label string. It does not reference
 * the engine, because a held value that references the target keeps it alive
 * forever. The token is a separate small object so the shared `idleToken` can
 * be returned in prod and `unregister` needs no engine reference.
 * @internal
 */
export function registerEngineLeak(target: object, variant: string): object {
  const registry = devRegistry();
  if (registry === undefined) return idleToken;
  leakSerial += 1;
  const label = `${variant}#${leakSerial}`;
  const token: object = {};
  registry.register(target, label, token);
  return token;
}

/** Drop the registration. A second call is a no-op. @internal */
export function unregisterEngineLeak(token: object): void {
  devRegistry()?.unregister(token);
}
