// packages/kit/src/plugin/index.ts
export { definePlugin } from "../define-plugin.js";
export type { GwenPluginFactory } from "../define-plugin.js";

export { satisfiesPluginContract, definePluginTypes } from "../plugin-types.js";
export type { PluginTypesOptions } from "../plugin-types.js";

// Type re-exports from @gwenjs/core — everything a plugin author needs
export type {
  GwenPlugin,
  GwenEngine,
  GwenProvides,
  GwenEngineOptions,
  WasmBridge,
  MemoryRegion,
  WasmModuleOptions,
  WasmModuleHandle,
  EntityId,
  ComponentType,
  GwenRuntimeHooks,
  GwenHookable,
  EngineErrorBus,
  PluginErrorContext,
} from "@gwenjs/core";

export { createEntityId, unpackEntityId } from "@gwenjs/core";
