/**
 * @file Engine configuration validator for SAFETY-01.
 * Validates `GwenEngineOptions` and throws `GwenConfigError` on invalid values.
 */

import { checkEngineConfig, formatReceived, type GwenConfigIssue } from "@gwenjs/schema";
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

const ENGINE_KEYS = [
  "maxEntities",
  "targetFPS",
  "maxDeltaSeconds",
  "variant",
  "loop",
  "physicsHz",
  "maxCatchupSteps",
  "debug",
] as const;

/**
 * Copies the eight engine fields, including inherited values.
 * Init fields (`jsUrl`, `wasmUrl`, `wasmInstance`, `_bridge`, `queryCacheSize`) are not read.
 */
function pickEngineFields(opts: GwenEngineOptions): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  const source: GwenEngineOptions & { loop?: unknown } = opts;
  for (const key of ENGINE_KEYS) {
    const value: unknown = source[key];
    if (value === undefined) continue;
    fields[key] = value;
  }
  return fields;
}

/**
 * Dev hint for one schema issue.
 * The three numeric fields core already checked keep their previous text.
 * `variant`, `loop`, `physicsHz`, `maxCatchupSteps`, and `debug` use the schema `expected` text.
 */
function configHint(issue: GwenConfigIssue, value: unknown): string {
  if (issue.path === "maxEntities") {
    if (typeof value === "number" && Number.isInteger(value) && value > 2_000_000) {
      return "Above 2 000 000 entities, consider chunking your world.";
    }
    return "Must be a positive integer. Try 10_000 for a typical game.";
  }
  if (issue.path === "targetFPS") {
    return "Must be between 1 and 300. Common values: 30, 60, 120.";
  }
  if (issue.path === "maxDeltaSeconds") {
    return "Must be > 0 and ≤ 10. Default 0.1 s prevents spiral-of-death.";
  }
  return `Expected ${issue.expected}.`;
}

function rejectConfig(fields: Readonly<Record<string, unknown>>, issue: GwenConfigIssue): never {
  const rejected = fields[issue.path];
  // Objects and functions can throw inside `String(value)`. Pass stable text instead.
  const value =
    (typeof rejected === "object" && rejected !== null) || typeof rejected === "function"
      ? formatReceived(rejected)
      : rejected;
  throw new GwenConfigError(issue.path, value, {
    hint: configHint(issue, rejected),
  });
}

/**
 * Validates engine configuration options.
 * Rules for the engine fields come from `@gwenjs/schema` `checkEngineConfig`.
 * Throws `GwenConfigError` (`CORE:INVALID_CONFIG`) for the first issue.
 * Also rejects an invalid `variant`, `loop`, `physicsHz`, `maxCatchupSteps`, or `debug`.
 * Logs console.warn for unusual but valid values.
 *
 * - `maxEntities`: integer in [1, 2_000_000]. Warns if > 500_000.
 * - `targetFPS`: finite number in [1, 300]. Warns if > 144.
 * - `maxDeltaSeconds`: finite number in (0, 10].
 * - `logger.minLevel`: When set, one of `debug`, `info`, `warn`, `error`.
 * - `logger.providers`: When set, an array of objects with a `handle` function.
 * - `logger`: `null` is omitted. Any other key is ignored.
 *
 * Fields that are undefined are skipped (will use defaults).
 *
 * @param opts - The engine options to validate.
 * @throws {GwenConfigError} if any checked field is invalid.
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
  const fields = pickEngineFields(opts);
  const issues = checkEngineConfig(fields, "@gwenjs/core");
  const issue = issues[0];

  if (issue?.path === "maxEntities") rejectConfig(fields, issue);
  // maxEntities warning. Only when the value is valid.
  if (opts.maxEntities !== undefined) {
    const v = opts.maxEntities;
    if (v > 500_000) {
      // eslint-disable-next-line no-console
      console.warn(
        `[GWEN] config warning: maxEntities value ${v} is unusual. Try 10_000 for a typical game.`,
      );
    }
  }

  if (issue?.path === "targetFPS") rejectConfig(fields, issue);
  // targetFPS warning. Only when the value is valid.
  if (opts.targetFPS !== undefined) {
    const v = opts.targetFPS;
    if (v > 144) {
      // eslint-disable-next-line no-console
      console.warn(
        `[GWEN] config warning: targetFPS value ${v} is unusual. Common values: 30, 60, 120.`,
      );
    }
  }

  if (issue !== undefined) rejectConfig(fields, issue);

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
