// packages/kit/src/module/index.ts
//
// Public entry point for module authors: import from '@gwenjs/kit/module'.
// Types are sourced from @gwenjs/schema; the factory function from define-module.

export { defineGwenModule, validateGwenModule } from "../define-module.js";
export { GwenModuleDefinitionError } from "../module-errors.js";

export type {
  GwenModule,
  GwenModuleDefinition,
  GwenKit,
  GwenBuildHooks,
  GwenBaseConfig,
  PluginDeclaration,
} from "@gwenjs/schema";
