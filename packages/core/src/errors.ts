/**
 * @file RFC-005 — Typed error classes for @gwenjs/core
 *
 * Central module for all engine-level error types.
 * Import from here in plugin packages and application code.
 */

export { GwenContextError } from './context.js';
export { GwenPluginNotFoundError } from './engine/gwen-engine.js';
export { GwenConfigError } from './engine/config-error.js';
