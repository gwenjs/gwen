/**
 * @gwenjs/kit — shared types only.
 *
 * For plugin authoring:  import from '@gwenjs/kit/plugin'
 * For module authoring:  import from '@gwenjs/kit/module'
 */
export type {
  AutoImport,
  GwenTypeTemplate,
  VitePlugin,
  ViteUserConfig,
  DeepPartial,
} from "./define-module.js";

export type {
  GwenConfig,
  MergePluginsPrefabExtensions,
  MergePluginsSceneExtensions,
  MergePluginsUIExtensions,
} from "./config.js";
