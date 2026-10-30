/**
 * @file Observability composables.
 *
 * `useLogger()`, `useErrorReporter()` and `usePerfMark()` read the logger of
 * the active scope. Call them inside a defineSystem(), defineActor() or
 * defineScene() factory, or in a plugin `setup()`. Outside any scope,
 * including after an `await` in plugin `setup()`, they throw
 * `GwenContextError` with code `CORE:OUTSIDE_ENGINE_CONTEXT`.
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

/**
 * Returns the active scope's engine logger, tagged `<type>:<name>`.
 * When the scope has no name, the tag uses `<type>:<id>`.
 * `meta.entityId` is passed to `child()` as a string when the scope has one.
 * A plugin `setup()` is a plugin scope, so the tag is `plugin:<name>`.
 *
 * @throws {GwenContextError} Code `CORE:OUTSIDE_ENGINE_CONTEXT` when there is
 *   no active scope. An `await` inside plugin `setup()` leaves the scope.
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
    throw new GwenContextError(GwenContextErrorCodes.OUTSIDE_ENGINE_CONTEXT, "useLogger");
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
      throw new GwenError(code, message, { composable: "useErrorReporter" });
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
