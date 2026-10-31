/**
 * @file Observability composables.
 *
 * `useLogger()` and `usePerfMark()` read the logger of the active scope.
 * `useErrorReporter().report` throws a `GwenError` (code `NAMESPACE:REASON`,
 * optional cause) and writes no log. Call them inside a defineSystem(),
 * defineActor() or defineScene() factory, or in a plugin `setup()`. Outside
 * any scope, including after an `await` in plugin `setup()`, they throw
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
 * Throws a typed `GwenError`. Does not write a log entry.
 *
 * Throws `GwenContextError` (`CORE:OUTSIDE_ENGINE_CONTEXT`) outside any scope,
 * same as {@link useLogger}.
 *
 * @example
 * ```typescript
 * const report = useErrorReporter()
 * if (!config.apiKey) {
 *   report.report('APP:CONFIG', 'Missing API key')
 * }
 * ```
 */
export function useErrorReporter() {
  // Throws outside a scope. report() writes no log.
  useLogger();
  return {
    /**
     * Throw a typed error. Does not log.
     *
     * @param code - `NAMESPACE:REASON` code.
     * @param message - Human-readable error message.
     * @param cause - Original thrown value, when there is one.
     * @throws {GwenError} Always.
     */
    report(code: `${string}:${string}`, message: string, cause?: unknown): never {
      throw new GwenError(code, message, { composable: "useErrorReporter", cause });
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
