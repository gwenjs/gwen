/**
 * @file Engine configuration validator for SAFETY-01.
 * Validates `GwenEngineOptions` and throws `GwenConfigError` on invalid values.
 */

import type { GwenLogLevel, IGwenLogProvider } from "@gwenjs/schema";
import type { GwenEngineOptions } from "./engine-types.js";
import { GwenConfigError } from "./config-error.js";

function isGwenLogLevel(value: unknown): value is GwenLogLevel {
  return value === "debug" || value === "info" || value === "warn" || value === "error";
}

function isLogProvider(value: unknown): value is IGwenLogProvider {
  if (typeof value !== "object" || value === null) return false;
  if (!("handle" in value)) return false;
  return typeof value.handle === "function";
}

function isProviderList(providers: unknown): boolean {
  return Array.isArray(providers) && providers.every(isLogProvider);
}

/**
 * Validates engine configuration options.
 * Throws `GwenConfigError` if any required field is invalid.
 * Logs console.warn for unusual but valid values.
 *
 * Validation rules:
 * - `maxEntities`: Must be a positive integer [1, 2_000_000]. Warns if > 500_000.
 * - `targetFPS`: Must be in range [1, 300] and finite. Warns if > 144.
 * - `maxDeltaSeconds`: Must be > 0 and ≤ 10, and finite.
 * - `logger.minLevel`: When set, one of `debug`, `info`, `warn`, `error`.
 * - `logger.providers`: When set, an array of objects with a `handle` function.
 * - `logger`: `null` is omitted. Any other key is ignored.
 *
 * Fields that are undefined are skipped (will use defaults).
 *
 * @param opts - The engine options to validate.
 * @throws {GwenConfigError} if any field is invalid.
 *
 * @example
 * ```ts
 * // Throws GwenConfigError
 * validateEngineConfig({ maxEntities: -1 });
 *
 * // Logs console.warn but does not throw
 * validateEngineConfig({ maxEntities: 600_000 });
 *
 * // Passes (all fields optional)
 * validateEngineConfig({});
 * ```
 */
export function validateEngineConfig(opts: GwenEngineOptions): void {
  // maxEntities validation
  if (opts.maxEntities !== undefined) {
    const v = opts.maxEntities;
    if (!Number.isInteger(v) || v < 1) {
      throw new GwenConfigError("maxEntities", v, {
        hint: "Must be a positive integer. Try 10_000 for a typical game.",
      });
    }
    if (v > 2_000_000) {
      throw new GwenConfigError("maxEntities", v, {
        hint: "Above 2 000 000 entities, consider chunking your world.",
      });
    }
    if (v > 500_000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[GWEN] config warning: maxEntities value ${v} is unusual. Try 10_000 for a typical game.`,
      );
    }
  }

  // targetFPS validation
  if (opts.targetFPS !== undefined) {
    const v = opts.targetFPS;
    if (!Number.isFinite(v) || v < 1 || v > 300) {
      throw new GwenConfigError("targetFPS", v, {
        hint: "Must be between 1 and 300. Common values: 30, 60, 120.",
      });
    }
    if (v > 144) {
      // eslint-disable-next-line no-console
      console.warn(
        `[GWEN] config warning: targetFPS value ${v} is unusual. Common values: 30, 60, 120.`,
      );
    }
  }

  // maxDeltaSeconds validation
  if (opts.maxDeltaSeconds !== undefined) {
    const v = opts.maxDeltaSeconds;
    if (!Number.isFinite(v) || v <= 0 || v > 10) {
      throw new GwenConfigError("maxDeltaSeconds", v, {
        hint: "Must be > 0 and ≤ 10. Default 0.1 s prevents spiral-of-death.",
      });
    }
  }

  // logger validation. Null is omitted. Read as unknown so a cast at the call site is still checked.
  if (opts.logger !== undefined && opts.logger !== null) {
    const minLevel: unknown = opts.logger.minLevel;
    const providers: unknown = opts.logger.providers;
    if (minLevel !== undefined && !isGwenLogLevel(minLevel)) {
      throw new GwenConfigError("logger.minLevel", minLevel, {
        hint: 'Use "debug", "info", "warn" or "error".',
      });
    }
    if (providers !== undefined && !isProviderList(providers)) {
      throw new GwenConfigError("logger.providers", providers, {
        hint: "Pass objects with a handle(entry) method.",
      });
    }
  }
}
