/**
 * Core variant detector for GWEN.
 *
 * Determines which core WASM variant (light, physics2d, physics3d) to use
 * from the modules declared in the project configuration.
 */

import type { CoreVariant } from "../engine/wasm-bridge";

/**
 * Plugins and modules read from the loaded gwen.config object.
 */
interface VariantConfig {
  plugins?: Array<{ name: string }>;
  modules?: Array<string | [string, unknown]>;
}

/**
 * Determine the core WASM variant from the project configuration.
 *
 * Rules (in order of priority):
 * 1. If '@gwenjs/physics3d' module is present → 'physics3d'
 * 2. If '@gwenjs/physics2d' module is present → 'physics2d'
 * 3. Default → 'light'
 *
 * `plugins` is ignored. Plugin display names never matched the real package names
 * (`@gwenjs/physics2d`, `@gwenjs/physics3d`).
 *
 * @param config - The loaded gwen.config object
 * @returns The detected CoreVariant
 */
export function detectCoreVariant(config: VariantConfig): CoreVariant {
  const moduleNames = resolveModuleNames(config.modules);

  if (moduleNames.includes("@gwenjs/physics3d")) {
    return "physics3d";
  }

  if (moduleNames.includes("@gwenjs/physics2d")) {
    return "physics2d";
  }

  return "light";
}

function resolveModuleNames(modules: VariantConfig["modules"]): string[] {
  if (!Array.isArray(modules)) return [];
  return modules.map((m) => (Array.isArray(m) ? m[0] : m));
}
