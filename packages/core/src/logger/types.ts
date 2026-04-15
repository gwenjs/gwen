/**
 * @gwenjs/core — logger type re-exports.
 *
 * Logger types have moved to `@gwenjs/schema`. This file re-exports them
 * for backwards compatibility so existing code importing from
 * `@gwenjs/core/src/logger/types` (internal) continues to compile.
 *
 * @deprecated Import logger types from `'@gwenjs/schema'` directly:
 * ```ts
 * import type { GwenLogger, LogLevel, LogEntry } from '@gwenjs/schema'
 * ```
 * This re-export will be removed in v2.0.
 */
export type { LogLevel, LogEntry, GwenLogger } from "@gwenjs/schema";
