/**
 * @file defineGwenModule — factory for GWEN build-time modules.
 *
 * All module types (`GwenKit`, `GwenModule`, `AutoImport`, etc.) are defined
 * in `@gwenjs/schema`. This file re-exports them and checks a definition
 * at runtime with `defineGwenModule()` / `validateGwenModule()`.
 *
 * Module authors should import from `@gwenjs/kit/module`:
 * ```ts
 * import { defineGwenModule } from '@gwenjs/kit/module'
 * import type { GwenKit } from '@gwenjs/kit/module'
 * ```
 */

export type {
  DeepPartial,
  AutoImport,
  VitePlugin,
  ViteUserConfig,
  GwenBuildHooks,
  GwenBaseConfig,
  GwenKit,
  GwenModuleDefinition,
  GwenModule,
} from "@gwenjs/schema";

import type { GwenModuleDefinition, GwenModule } from "@gwenjs/schema";
import { GwenModuleDefinitionError } from "./module-errors.js";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Plain objects and prototype-less records. Arrays and class instances are not. */
function isPlainObject(value: unknown): boolean {
  if (!isObjectRecord(value) || Array.isArray(value)) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function nameAccepted(rawName: unknown): boolean {
  return typeof rawName === "string" && rawName !== "" && rawName.trim() === rawName;
}

/**
 * Checks every field of a module definition and throws once.
 *
 * A non-object `def` (null, a number) is treated as `{}`.
 * `module` is `meta.name` when that is a non-empty string, otherwise
 * `fallbackName` or `"<anonymous>"`.
 *
 * @param def - Value exported by a module file, or passed to `defineGwenModule()`.
 * @param fallbackName - Label used when `meta.name` is missing or empty.
 */
export function validateGwenModule(
  def: unknown,
  fallbackName?: string,
): asserts def is GwenModuleDefinition {
  const record = isObjectRecord(def) ? def : {};
  const meta = record["meta"];
  const metaRecord = isObjectRecord(meta) ? meta : undefined;
  const rawName = metaRecord?.["name"];
  const moduleName =
    typeof rawName === "string" && rawName !== "" ? rawName : (fallbackName ?? "<anonymous>");
  const fields: string[] = [];

  if (metaRecord === undefined) {
    fields.push("meta");
  } else if (!nameAccepted(metaRecord["name"])) {
    fields.push("meta.name");
  }
  if (
    metaRecord !== undefined &&
    "configKey" in metaRecord &&
    typeof metaRecord["configKey"] !== "string"
  ) {
    fields.push("meta.configKey");
  }
  if (
    metaRecord !== undefined &&
    "version" in metaRecord &&
    typeof metaRecord["version"] !== "string"
  ) {
    fields.push("meta.version");
  }
  if ("defaults" in record && !isPlainObject(record["defaults"])) fields.push("defaults");
  if (typeof record["setup"] !== "function") fields.push("setup");
  if ("validate" in record && typeof record["validate"] !== "function") fields.push("validate");

  if (fields.length > 0) throw new GwenModuleDefinitionError(moduleName, fields);
}

/**
 * Defines a GWEN module — a build-time extension that registers runtime
 * plugins, auto-imports, and Vite extensions.
 *
 * Modules run in Node.js during `gwen dev`, `gwen build`, or `gwen prepare`.
 * They are the primary way to add capabilities to a GWEN project.
 *
 * Invalid fields throw {@link GwenModuleDefinitionError} (`KIT:MODULE_INVALID`).
 * The return value is `definition` itself.
 *
 * @template Options - The typed options shape this module accepts.
 * @param definition - Module definition: metadata, defaults, and `setup` function.
 * @returns The same definition, ready for use in `gwen.config.ts`.
 *
 * @example
 * ```ts
 * import { defineGwenModule } from '@gwenjs/kit/module'
 *
 * export default defineGwenModule<Physics2DOptions>({
 *   meta: { name: '@gwenjs/physics2d', configKey: 'physics2d' },
 *   defaults: { gravity: 9.81, iterations: 8 },
 *   async setup(options, gwen) {
 *     gwen.addPlugin({ src: '@gwenjs/physics2d', export: 'Physics2DPlugin', options })
 *     gwen.addAutoImports([{ name: 'usePhysics2D', from: '@gwenjs/physics2d' }])
 *   },
 * })
 * ```
 */
export function defineGwenModule<Options extends object = Record<string, unknown>>(
  definition: GwenModuleDefinition<Options>,
): GwenModule<Options> {
  validateGwenModule(definition);
  return definition;
}
