/**
 * GWEN Configuration Schema - Validation
 *
 * Lightweight runtime validation without external dependencies (no Zod).
 *
 * @module @gwenjs/schema
 */

import type { GwenOptions, GwenModuleEntry, GwenConfigInput } from './config';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidModuleEntry(entry: unknown): entry is GwenModuleEntry {
  if (typeof entry === 'string') {
    return entry.length > 0;
  }

  if (!Array.isArray(entry) || entry.length === 0 || entry.length > 2) {
    return false;
  }

  if (typeof entry[0] !== 'string' || entry[0].length === 0) {
    return false;
  }

  if (entry.length === 1) {
    return true;
  }

  return entry[1] === undefined || isPlainObject(entry[1]);
}

function hasLegacyPluginDeclaration(input: GwenConfigInput): boolean {
  const hasPlugins = Array.isArray(input.plugins) && input.plugins.length > 0;
  const hasTsPlugins = Array.isArray(input.tsPlugins) && input.tsPlugins.length > 0;
  const hasWasmPlugins = Array.isArray(input.wasmPlugins) && input.wasmPlugins.length > 0;
  return hasPlugins || hasTsPlugins || hasWasmPlugins;
}

function normalizeModules(input: GwenConfigInput): GwenModuleEntry[] {
  if (!Array.isArray(input.modules)) {
    return [];
  }
  return input.modules.filter((entry): entry is GwenModuleEntry => entry !== undefined);
}

/**
 * Enforce module-first framework configuration.
 *
 * This guard rejects legacy plugin-array composition when no modules are
 * declared, and provides a migration-focused error message.
 */
export function assertModuleFirstInput(input: GwenConfigInput): void {
  const modules = normalizeModules(input);
  if (modules.length > 0) {
    return;
  }

  if (!hasLegacyPluginDeclaration(input)) {
    return;
  }

  throw new Error(
    'Module-first configuration required: declare at least one entry in `modules` and migrate legacy `plugins`/`tsPlugins`/`wasmPlugins` usage.',
  );
}

/**
 * Validate a resolved GWEN configuration.
 *
 * @param config - The resolved configuration to validate
 * @returns The same config object if valid
 * @throws Error with stable message if validation fails
 */
export function validateResolvedConfig(config: GwenOptions): GwenOptions {
  const maxEntities = config.engine.maxEntities;
  if (!Number.isInteger(maxEntities) || maxEntities < 100 || maxEntities > 1_000_000) {
    throw new Error('maxEntities must be between 100 and 1000000');
  }

  const targetFPS = config.engine.targetFPS;
  if (typeof targetFPS !== 'number' || targetFPS < 30 || targetFPS > 240) {
    throw new Error('targetFPS must be between 30 and 240');
  }

  if (config.engine.loop !== 'internal' && config.engine.loop !== 'external') {
    throw new Error("engine.loop must be 'internal' or 'external'");
  }

  const maxDelta = config.engine.maxDeltaSeconds;
  if (typeof maxDelta !== 'number' || maxDelta <= 0 || maxDelta > 1) {
    throw new Error('engine.maxDeltaSeconds must be > 0 and <= 1');
  }

  const hexColorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
  if (!hexColorRegex.test(config.html.background)) {
    throw new Error('background must be a valid hex color');
  }

  if (!Array.isArray(config.modules)) {
    throw new Error('modules must be an array');
  }

  for (let index = 0; index < config.modules.length; index += 1) {
    if (!isValidModuleEntry(config.modules[index])) {
      throw new Error(
        `modules[${index}] must be a string or a [name, options] tuple with object options`,
      );
    }
  }

  if (!Array.isArray(config.plugins)) {
    throw new Error('plugins must be an array');
  }

  return config;
}
