/**
 * @file Build-time resolution of framework providers (Node.js only).
 *
 * Walks the declarations in install order. A framework provider a declaration requires is
 * inserted right before the first declaration that does. Nothing is moved or dropped.
 */

import { GwenError } from "@gwenjs/schema";
import type { GwenEngineServiceKey, PluginDeclaration } from "@gwenjs/schema";
import { AppErrorCodes } from "./error-codes";
import type { FrameworkProviderTable } from "./framework-providers";

/** A declaration with the name of the module that registered it. */
export interface OwnedDeclaration {
  readonly declaration: PluginDeclaration;
  readonly owner: string;
}

/** What is installed before the first declaration: plugin names and provided service keys. */
export interface InstalledBefore {
  readonly plugins: ReadonlySet<string>;
  readonly services: ReadonlySet<string>;
}

/** Owner recorded for an inserted row. */
export const FRAMEWORK_OWNER = "framework provider";

/**
 * When the engine provides a service key. `dev` = provided only under `__GWEN_DEV__`.
 * The build-time check has no build mode, so a `dev` key never counts as installed: a
 * declaration that requires it fails with `APP:SERVICE_PROVIDER_MISSING` unless it lists the
 * key in `requires.optional`.
 */
type EngineKeyAvailability = "always" | "dev";

/**
 * Availability of every engine-owned service key. Every new engine key must state its
 * availability here: the `Record` makes the compiler enforce it.
 */
const ENGINE_SERVICE_KEYS: Record<GwenEngineServiceKey, EngineKeyAvailability> = {
  logger: "always",
  errors: "always",
  "wasm:bridge": "always",
  memory: "always",
  introspection: "dev",
};

/** Engine-owned service keys provided in every build, installed before any plugin. */
export const engineServiceKeys: readonly string[] = Object.entries(ENGINE_SERVICE_KEYS)
  .filter(([, availability]) => availability === "always")
  .map(([key]) => key);

function sameRow(left: PluginDeclaration, right: PluginDeclaration): boolean {
  return left.src === right.src && left.export === right.export;
}

function isNamed(value: unknown): value is { readonly name: unknown } {
  return typeof value === "object" && value !== null && "name" in value;
}

/** Plugin names a declaration requires. An extension object `{ name, extensionApi }` counts by `name`. */
function pluginNames(declaration: PluginDeclaration): readonly string[] {
  const entries: readonly unknown[] = declaration.requires?.plugins ?? [];
  return entries.flatMap((entry) => {
    if (typeof entry === "string") return [entry];
    const name: unknown = isNamed(entry) ? entry.name : undefined;
    return typeof name === "string" ? [name] : [];
  });
}

function orderError(consumer: string, name: string, provider: string): GwenError {
  return new GwenError(
    AppErrorCodes.PLUGIN_REQUIREMENT_ORDER,
    `Module "${consumer}" requires "${name}", which module "${provider}" declares later.`,
    {
      composable: "defineConfig",
      hint: __GWEN_DEV__
        ? `Move "${provider}" before "${consumer}" in modules, or remove it: the framework installs framework providers.`
        : undefined,
    },
  );
}

function missingError(module: string, key: string): GwenError {
  return new GwenError(
    AppErrorCodes.SERVICE_PROVIDER_MISSING,
    `Module "${module}" requires service "${key}", which no module, config plugin or framework provider installs.`,
    {
      composable: "defineConfig",
      hint: __GWEN_DEV__
        ? `Add the module that provides "${key}", or declare it in requires.optional if the plugin works without it.`
        : undefined,
    },
  );
}

/**
 * Inserts the framework providers the declarations require. Returns a new list.
 * The table is read, never changed: an inserted row is a copy.
 *
 * A plugin name with no row and no installed plugin is left to the runtime check
 * (`CORE:PLUGIN_DEPENDENCY_MISSING`).
 *
 * @throws {GwenError} `APP:PLUGIN_REQUIREMENT_ORDER` when a provider is declared after its consumer.
 *   `APP:SERVICE_PROVIDER_MISSING` when a hard service has no provider.
 */
export function insertFrameworkProviders(
  entries: readonly OwnedDeclaration[],
  installed: InstalledBefore,
  table: FrameworkProviderTable,
): OwnedDeclaration[] {
  const list = [...entries];
  for (let at = 0; at < list.length; at += 1) {
    const consumer = list[at];
    if (consumer === undefined) continue;
    const requires = consumer.declaration.requires;
    if (requires === undefined) continue;
    const wanted: Array<readonly ["plugins" | "services", string]> = [
      ...pluginNames(consumer.declaration).map((name) => ["plugins", name] as const),
      ...(requires.services ?? []).map((key) => ["services", key] as const),
    ];
    for (const [kind, name] of wanted) {
      // `table[kind][name]` alone would return `Object.prototype` members ("constructor").
      const row = Object.hasOwn(table[kind], name) ? table[kind][name] : undefined;
      const isProvider = (entry: OwnedDeclaration): boolean =>
        kind === "services"
          ? (entry.declaration.provides ?? []).some((key) => key === name)
          : row !== undefined && sameRow(entry.declaration, row);
      if ((kind === "plugins" ? installed.plugins : installed.services).has(name)) continue;
      if (list.slice(0, at).some(isProvider)) continue;
      const later = list.slice(at + 1).find(isProvider);
      if (later !== undefined) throw orderError(consumer.owner, name, later.owner);
      if (row !== undefined) {
        list.splice(at, 0, { declaration: { ...row }, owner: FRAMEWORK_OWNER });
        at += 1;
        continue;
      }
      if (kind === "services") throw missingError(consumer.owner, name);
    }
  }
  return list;
}
