/**
 * @file Engine configuration validator for SAFETY-01.
 * Validates `GwenEngineOptions` and throws `GwenConfigError` on invalid values.
 */

import type { GwenEngineOptions } from './gwen-engine.js';
import { GwenConfigError } from './config-error.js';

/**
 * Validates engine configuration options.
 * Throws `GwenConfigError` if any required field is invalid.
 * Logs console.warn for unusual but valid values.
 *
 * Validation rules:
 * - `maxEntities`: Must be a positive integer [1, 2_000_000]. Warns if > 500_000.
 * - `targetFPS`: Must be in range [1, 300] and finite. Warns if > 144.
 * - `maxDeltaSeconds`: Must be > 0 and ≤ 10, and finite.
 * - `tweenPoolSize`: (if provided) Must be a positive integer. Warns if > 4096.
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
      throw new GwenConfigError(
        'maxEntities',
        v,
        'Must be a positive integer. Try 10_000 for a typical game.',
      );
    }
    if (v > 2_000_000) {
      throw new GwenConfigError(
        'maxEntities',
        v,
        'Above 2 000 000 entities, consider chunking your world.',
      );
    }
    if (v > 500_000) {
      console.warn(
        `[GWEN] config warning: maxEntities value ${v} is unusual. Try 10_000 for a typical game.`,
      );
    }
  }

  // targetFPS validation
  if (opts.targetFPS !== undefined) {
    const v = opts.targetFPS;
    if (!Number.isFinite(v) || v < 1 || v > 300) {
      throw new GwenConfigError(
        'targetFPS',
        v,
        'Must be between 1 and 300. Common values: 30, 60, 120.',
      );
    }
    if (v > 144) {
      console.warn(
        `[GWEN] config warning: targetFPS value ${v} is unusual. Common values: 30, 60, 120.`,
      );
    }
  }

  // maxDeltaSeconds validation
  if (opts.maxDeltaSeconds !== undefined) {
    const v = opts.maxDeltaSeconds;
    if (!Number.isFinite(v) || v <= 0 || v > 10) {
      throw new GwenConfigError(
        'maxDeltaSeconds',
        v,
        'Must be > 0 and ≤ 10. Default 0.1 s prevents spiral-of-death.',
      );
    }
  }

  // tweenPoolSize validation (only if provided)
  if (opts.tweenPoolSize !== undefined) {
    const v = opts.tweenPoolSize;
    if (!Number.isInteger(v) || v < 1) {
      throw new GwenConfigError(
        'tweenPoolSize',
        v,
        'Must be a positive integer. Default 256 suits most games.',
      );
    }
    if (v > 4096) {
      console.warn(
        `[GWEN] config warning: tweenPoolSize value ${v} is unusual. Default 256 suits most games.`,
      );
    }
  }
}
