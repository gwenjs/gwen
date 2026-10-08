/**
 * @file Observability composables for plugin authors.
 *
 * These helpers provide access to logging, error reporting, and performance
 * timing in a consistent way across GWEN plugins and modules.
 *
 * @example
 * ```typescript
 * import { useLogger, usePerfMark } from '@gwenjs/kit'
 *
 * export const MyPlugin = definePlugin(() => ({
 *   name: 'MyPlugin',
 *   setup(engine) {
 *     const log = useLogger()
 *     const stopTimer = usePerfMark('initialization')
 *     // ... do work ...
 *     stopTimer()
 *   },
 * }))
 * ```
 */

import { GwenError, type IGwenLogger } from "@gwenjs/schema";

/**
 * No-op logger that silently drops all messages.
 */
const _noopLogger: IGwenLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return _noopLogger;
  },
};

/**
 * Attempts to retrieve the current engine's logger.
 * Falls back to a no-op logger if called outside an engine context.
 *
 * @internal
 */
function _getLogger(): IGwenLogger {
  try {
    // Try to get logger from engine context if available
    // For now, return noop since GwenScope (Groupe C) is not yet implemented
    // This will be enhanced when engine context is available
    return _noopLogger;
  } catch {
    return _noopLogger;
  }
}

/**
 * Returns a logger pre-tagged with the current scope type and name.
 * Falls back to the root engine logger if called outside any scope.
 *
 * When scope context is available (Groupe C), this will automatically
 * include scope information like `'actor:PlayerController'` or `'system:PhysicsSystem'`.
 *
 * @example
 * ```typescript
 * const log = useLogger()
 * log.info('Starting initialization', { module: 'physics' })
 * ```
 */
export function useLogger(): IGwenLogger {
  return _getLogger();
}

/**
 * Error reporter composable.
 *
 * Used to report typed errors with structured information about
 * the current scope. When GwenScope is available, includes context like
 * actor name, system name, and phase.
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
 * Automatically logs elapsed time when stopped.
 *
 * Useful for measuring initialization, frame phases, or any other timing-sensitive operation.
 *
 * @param label - A human-readable label for this mark (e.g., 'physics-step', 'asset-load')
 * @returns A stop function that logs the elapsed time and returns the duration in milliseconds
 *
 * @example
 * ```typescript
 * const stopTimer = usePerfMark('asset-loading')
 * await loadAssets()
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
