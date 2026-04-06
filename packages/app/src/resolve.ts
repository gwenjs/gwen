/**
 * @file @gwenjs/app/resolve — Node.js-only server-side exports.
 *
 * This sub-path export contains APIs that depend on Node.js built-ins
 * (c12, fs, etc.) and must NEVER be imported from browser-side code.
 *
 * Used by the CLI (`gwen prepare`, `gwen dev`) — never in gwen.config.ts.
 *
 * @example
 * ```typescript
 * // In CLI code (Node.js only):
 * import { resolveGwenConfig, GwenApp } from '@gwenjs/app/resolve'
 * ```
 */

export { resolveConfig, resolveGwenConfig } from './config';
export { loadRawGwenConfig, GwenConfigLoadError } from './config-loader';
export type { RawGwenConfig } from './config-loader';
export type {
  GwenUserConfig,
  ResolvedGwenConfig,
  GwenModuleOptions,
  GwenModuleEntry,
  GwenBuildHooks,
} from './types';
export { GwenApp } from './app';
