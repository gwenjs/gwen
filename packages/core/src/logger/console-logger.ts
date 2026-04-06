import type { GwenLogger, LogEntry, LogLevel } from './types';

/**
 * Format a {@link LogEntry} into a human-readable string.
 *
 * Output format: `[source] message  key="value"  frame=N`
 *
 * @param entry - The log entry to format.
 * @returns A formatted string representation of the entry.
 */
function formatEntry(entry: LogEntry): string {
  const parts: string[] = [`[${entry.source}] ${entry.message}`];
  if (entry.data) {
    for (const [k, v] of Object.entries(entry.data)) {
      parts.push(`${k}=${JSON.stringify(v)}`);
    }
  }
  if (entry.frame !== undefined) parts.push(`frame=${entry.frame}`);
  return parts.join('  ');
}

/**
 * Default console sink — forwards entries to the appropriate `console.*` method.
 *
 * @param entry - The log entry to write to the console.
 */
function defaultConsoleSink(entry: LogEntry): void {
  const msg = formatEntry(entry);
  switch (entry.level) {
    case 'debug':
      console.debug(msg);
      break;
    case 'info':
      console.info(msg);
      break;
    case 'warn':
      console.warn(msg);
      break;
    case 'error':
      console.error(msg);
      break;
  }
}

/**
 * Create a child logger sharing the given sink reference.
 *
 * @param source - The source identifier for all entries emitted by this logger.
 * @param debugMode - When `false`, `debug` and `info` entries are suppressed.
 * @param getFrame - Optional callback returning the current frame index.
 * @param sinkRef - Shared mutable sink wrapper; mutating `.fn` propagates to all children.
 * @returns A {@link GwenLogger} bound to `source`.
 */
function createChildLogger(
  source: string,
  debugMode: boolean,
  getFrame: (() => number) | undefined,
  sinkRef: { fn: (entry: LogEntry) => void },
): GwenLogger {
  function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if ((level === 'debug' || level === 'info') && !debugMode) return;
    const entry: LogEntry = {
      level,
      source,
      message,
      data,
      frame: getFrame?.(),
      ts: performance.now(),
    };
    sinkRef.fn(entry);
  }

  return {
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
    child(childSource: string): GwenLogger {
      return createChildLogger(childSource, debugMode, getFrame, sinkRef);
    },
    setSink(sink: (entry: LogEntry) => void): void {
      sinkRef.fn = sink;
    },
  };
}

/**
 * Create a root {@link GwenLogger} instance.
 *
 * The returned logger and all child loggers share a single sink reference.
 * Calling `setSink()` on any logger in the tree replaces the sink for all of them.
 *
 * @param source - Source identifier for entries emitted by this logger, e.g. `'gwen:core'`.
 * @param debugMode - When `false`, `debug` and `info` calls are silent (no-op).
 *   `warn` and `error` always emit regardless of this flag.
 * @param getFrame - Optional callback returning the current engine frame index.
 *   When provided, {@link LogEntry.frame} is populated on every entry.
 * @returns A root {@link GwenLogger}.
 *
 * @example
 * ```typescript
 * const logger = createLogger('gwen:core', true, () => engine.frameCount)
 * logger.debug('engine started')
 *
 * const pluginLog = logger.child('@gwenjs/physics2d')
 * pluginLog.warn('physics step exceeded budget', { ms: 22 })
 * ```
 */
export function createLogger(
  source: string,
  debugMode: boolean,
  getFrame?: () => number,
): GwenLogger {
  // Shared sink ref — all children share this object so setSink propagates to every descendant.
  const sinkRef: { fn: (entry: LogEntry) => void } = { fn: defaultConsoleSink };

  function emit(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if ((level === 'debug' || level === 'info') && !debugMode) return;
    const entry: LogEntry = {
      level,
      source,
      message,
      data,
      frame: getFrame?.(),
      ts: performance.now(),
    };
    sinkRef.fn(entry);
  }

  const logger: GwenLogger = {
    debug: (msg, data) => emit('debug', msg, data),
    info: (msg, data) => emit('info', msg, data),
    warn: (msg, data) => emit('warn', msg, data),
    error: (msg, data) => emit('error', msg, data),
    child(childSource: string): GwenLogger {
      return createChildLogger(childSource, debugMode, getFrame, sinkRef);
    },
    setSink(sink: (entry: LogEntry) => void): void {
      sinkRef.fn = sink;
    },
  };
  return logger;
}
