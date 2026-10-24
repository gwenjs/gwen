/**
 * @file Observability composables.
 *
 * `useLogger()`, `useErrorReporter()` and `usePerfMark()` read the logger of
 * the active scope. Call them inside a defineSystem(), defineActor() or
 * defineScene() factory. Outside any scope they throw `GwenContextError`
 * with code `CORE:OUTSIDE_ENGINE_CONTEXT`. A plugin `setup()` has no scope
 * until #73, so these composables throw there too.
 *
 * @example
 * ```typescript
 * import { defineSystem } from '@gwenjs/core/system'
 * import { useLogger, usePerfMark } from '@gwenjs/kit'
 *
 * export const mover = defineSystem('Mover', () => {
 *   const log = useLogger()
 *   const stopTimer = usePerfMark('initialization')
 *   log.info('ready')
 *   stopTimer()
 * })
 * ```
 */

import { GwenError, type IGwenLogger } from "@gwenjs/schema";

import { GwenContextError, GwenContextErrorCodes } from "./context-errors.js";
import { getCurrentScope } from "./scope-slot.js";

const OUTSIDE_LOGGER =
  "[GWEN] useLogger() must be called inside a defineSystem(), defineActor() or defineScene() factory.";

/** Engine object that carries the public logger. */
function hasLogger(e: unknown): e is { logger: IGwenLogger } {
  if (typeof e !== "object" || e === null) return false;
  if (!("logger" in e)) return false;
  const logger = e.logger;
  if (typeof logger !== "object" || logger === null) return false;
  if (!("child" in logger)) return false;
  return typeof logger.child === "function";
}

/**
 * Returns the active scope's engine logger, tagged `<type>:<name>`.
 * When the scope has no name, the tag uses `<type>:<id>`.
 * `meta.entityId` is passed to `child()` as a string when the scope has one.
 *
 * @throws {GwenContextError} Code `CORE:OUTSIDE_ENGINE_CONTEXT` when there is
 *   no active scope, or when that scope's engine has no logger.
 *
 * @example
 * ```typescript
 * // Inside a defineSystem(), defineActor() or defineScene() factory
 * const log = useLogger()
 * log.info('Starting initialization', { module: 'physics' })
 * ```
 */
export function useLogger(): IGwenLogger {
  const scope = getCurrentScope();
  if (scope === null) {
    throw new GwenContextError(OUTSIDE_LOGGER, GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT);
  }
  if (!hasLogger(scope.engine)) {
    throw new GwenContextError(OUTSIDE_LOGGER, GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT);
  }
  return scope.engine.logger.child(
    `${scope.meta.type}:${scope.meta.name ?? scope.meta.id}`,
    scope.meta.entityId?.toString(),
  );
}

/**
 * Reports a typed error on the scope-tagged logger, then throws `GwenError`.
 *
 * Throws `GwenContextError` (`CORE:OUTSIDE_ENGINE_CONTEXT`) outside any scope,
 * same as {@link useLogger}.
 *
 * @example
 * ```typescript
 * const report = useErrorReporter()
 * if (!config.apiKey) {
 *   report.report('CONFIG_ERROR', 'Missing API key')
 * }
 * ```
 */
export function useErrorReporter() {
  const log = useLogger();
  return {
    /**
     * Report an error with a code and message.
     * Always throws after logging.
     *
     * @param code - Error code (e.g., 'CONFIG_ERROR', 'VALIDATION_ERROR')
     * @param message - Human-readable error message
     * @throws {GwenError} Always throws with the structured error message
     */
    report(code: string, message: string): never {
      log.error(`[${code}] ${message}`);
      throw new GwenError(code, `[${code}] ${message}`);
    },
  };
}

/**
 * Records a named performance mark and returns a stop function.
 * The stop function logs elapsed time on the scope-tagged logger.
 *
 * Throws `GwenContextError` (`CORE:OUTSIDE_ENGINE_CONTEXT`) outside any scope,
 * same as {@link useLogger}.
 *
 * @param label - A human-readable label for this mark (e.g., 'physics-step', 'asset-load')
 * @returns A stop function that logs the elapsed time and returns the duration in milliseconds
 * @throws {GwenContextError} Code `CORE:OUTSIDE_ENGINE_CONTEXT` outside any scope.
 *
 * @example
 * ```typescript
 * const stopTimer = usePerfMark('asset-loading')
 * const durationMs = stopTimer()
 * // Logs: [perf] asset-loading  durationMs=123.45
 * ```
 */
export function usePerfMark(label: string): () => number {
  const log = useLogger();
  const start = performance.now();

  return () => {
    const durationMs = performance.now() - start;
    log.debug(`[perf] ${label}`, { durationMs });
    return durationMs;
  };
}
