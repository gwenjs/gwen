/**
 * Core variant detector for GWEN.
 *
 * Determines which core WASM variant (light, physics2d, physics3d) to use
 * based on the plugins declared in the project configuration.
 */

import type { CoreVariant } from '../engine/wasm-bridge';

/**
 * Interface that matches the relevant part of GwenConfig for detection.
 */
interface VariantConfig {
  plugins?: Array<{ name: string; wasm?: { sharedMemory?: boolean } }>;
  modules?: Array<string | [string, unknown]>;
}

/**
 * Determine the core WASM variant from the project configuration.
 *
 * Rules (in order of priority):
 * 1. If 'Physics3D' plugin or '@gwenjs/physics3d' module is present → 'physics3d'
 * 2. If 'Physics2D' plugin or '@gwenjs/physics2d' module is present → 'physics2d'
 * 3. Default → 'light'
 *
 * @param config - The loaded GwenConfig object
 * @returns The detected CoreVariant
 */
export function detectCoreVariant(config: VariantConfig): CoreVariant {
  const moduleNames = resolveModuleNames(config.modules);
  const pluginNames = Array.isArray(config.plugins) ? config.plugins.map((p) => p.name) : [];

  if (pluginNames.includes('Physics3D') || moduleNames.includes('@gwenjs/physics3d')) {
    return 'physics3d';
  }

  if (pluginNames.includes('Physics2D') || moduleNames.includes('@gwenjs/physics2d')) {
    return 'physics2d';
  }

  return 'light';
}

/**
 * Returns true when at least one plugin explicitly opts into SAB.
 */
export function detectSharedMemoryRequired(config: VariantConfig): boolean {
  if (!config || !Array.isArray(config.plugins)) {
    return false;
  }
  return config.plugins.some((p) => p?.wasm?.sharedMemory === true);
}

function resolveModuleNames(modules: VariantConfig['modules']): string[] {
  if (!Array.isArray(modules)) return [];
  return modules.map((m) => (Array.isArray(m) ? m[0] : m));
}
