/* oxlint-disable no-unused-vars -- type fixture: the checker is the assertion */

import type * as Root from "@gwenjs/kit";
import type * as T_plugin from "@gwenjs/kit/plugin";
import type * as T_module from "@gwenjs/kit/module";

type _0 = [
  Root.AutoImport,
  Root.DeepPartial<never>,
  Root.GwenConfig,
  Root.GwenContextBoundary,
  Root.GwenContextErrorCode,
  Root.MergePluginsPrefabExtensions<never>,
  Root.MergePluginsSceneExtensions<never>,
  Root.MergePluginsUIExtensions<never>,
  Root.VitePlugin,
  Root.ViteUserConfig,
];
type _1 = [
  T_plugin.ComponentType,
  T_plugin.EntityId,
  T_plugin.GwenPlugin,
  T_plugin.GwenPluginFactory<never, never>,
  T_plugin.GwenProvides,
  T_plugin.GwenRuntimeHooks,
  T_plugin.PluginErrorContext,
];
type _2 = [
  T_module.GwenBaseConfig,
  T_module.GwenBuildHooks,
  T_module.GwenKit,
  T_module.GwenModule,
  T_module.GwenModuleDefinition,
  T_module.PluginDeclaration,
];
