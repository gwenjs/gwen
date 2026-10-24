// packages/kit/src/plugin/index.ts
export { definePlugin } from "../define-plugin.js";
export type { GwenPluginFactory } from "../define-plugin.js";

export { satisfiesPluginContract } from "../plugin-types.js";

// Type and value re-exports from @gwenjs/schema — everything a plugin author needs
export type {
  GwenPlugin,
  GwenProvides,
  GwenRuntimeHooks,
  EntityId,
  ComponentType,
  PluginErrorContext,
} from "@gwenjs/schema";

export { createEntityId, unpackEntityId } from "@gwenjs/schema";
