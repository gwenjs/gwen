/**
 * @file Barrel re-export for all OXC AST utilities used by the GWEN Vite plugin.
 *
 * Import from this module instead of directly from `oxc-walker` or the
 * individual helper files so the public surface stays stable even if the
 * underlying packages change.
 *
 * @example
 * ```ts
 * import { walk, parseSource, isCallTo, getCallArgs } from '../oxc/index.js';
 * ```
 */

export { walk, parseAndWalk, ScopeTracker } from 'oxc-walker';
export type { WalkOptions, WalkerEnter, WalkerThisContextEnter } from 'oxc-walker';
export type { Node } from 'oxc-parser';
export * from './helpers.js';
export * from './parse.js';
