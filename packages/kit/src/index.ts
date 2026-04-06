/**
 * @gwenjs/kit — GWEN plugin authoring kit.
 *
 * Provides helpers and type re-exports for creating GWEN plugins.
 * Intended for plugin authors — both first-party (official plugins)
 * and third-party (community / ecosystem plugins).
 *
 * ## What belongs here
 * - `definePlugin()` — factory for TS-only and WASM plugins
 * - Type re-exports needed to author a plugin (no game-loop primitives)
 *
 * ## What does NOT belong here
 * - `defineSystem()`, `defineScene()`, `defineUI()`, `definePrefab()` —
 *   these are game development primitives, not plugin authoring tools.
 *   Import them from `@gwenjs/core`.
 * - `defineConfig()`, `createEngine()` — project bootstrap, not authoring.
 *   Import `defineConfig` from `@gwenjs/app` and `createEngine` from `@gwenjs/core`.
 */

// ── RFC-004: Module system ────────────────────────────────────────────────────

export { defineGwenModule } from './define-module';
export type {
  GwenModule,
  GwenModuleDefinition,
  GwenKit,
  GwenBuildHooks,
  GwenBaseConfig,
  AutoImport,
  GwenTypeTemplate,
  VitePlugin,
  ViteUserConfig,
  DeepPartial,
} from './define-module';

// ── Project config helper ─────────────────────────────────────────────────────
// defineConfig has moved to `@gwenjs/app` (RFC-004). Do not re-export here.

// ── RFC-002: Plugin contract helpers ─────────────────────────────────────────

export { satisfiesPluginContract, definePluginTypes } from './plugin-types';
export type { PluginTypesOptions } from './plugin-types';

// ── Plugin authoring helper ───────────────────────────────────────────────────

export { definePlugin } from './define-plugin';
export type { GwenPluginFactory } from './define-plugin';

// ── Type re-exports from @gwenjs/core ────────────────────────────────────
// Only types necessary to *author* a plugin are re-exported here.
// Game-loop primitives (defineSystem, defineScene, etc.) are intentionally omitted.

export type {
  // Plugin interfaces (RFC-001 V2 GwenPlugin is the canonical interface)
  GwenPlugin,

  // Engine interface — received in setup()
  GwenEngine,
  GwenProvides,

  // WASM infrastructure
  WasmBridge,
  MemoryRegion,
  WasmModuleOptions,

  // Entity / component primitives needed in plugin implementations
  EntityId,
  ComponentType,

  // Hooks
  GwenRuntimeHooks,
  GwenHookable,
} from '@gwenjs/core';

// ── Runtime re-exports (values, not types) ────────────────────────────────────

export { createEntityId, unpackEntityId } from '@gwenjs/core';
