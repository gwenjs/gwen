/**
 * Shared build-time module for a dimension physics package.
 */

import { defineGwenModule } from "@gwenjs/kit/module";
import type { GwenModule } from "@gwenjs/kit/module";
import type { AutoImport, DeepPartial, GwenConfigIssue, VitePlugin } from "@gwenjs/schema";

/**
 * Input of {@link definePhysicsModule}.
 *
 * `setup` registers `plugin` with the resolved options, copies `autoImports`,
 * and copies the fields of the Vite plugin built from those options.
 *
 * @template Options - Options stored under `configKey`.
 */
export interface PhysicsModuleDefinition<Options extends object = Record<string, unknown>> {
  /** Package name stored on `meta.name`. */
  readonly name: string;

  /** Config key stored on `meta.configKey`. */
  readonly configKey: string;

  /** Default options. The same object is returned on the module. */
  readonly defaults: DeepPartial<Options>;

  /**
   * Checks resolved options.
   * The property is absent when the caller does not pass a function.
   *
   * @param options - Resolved options.
   * @returns The caller's issues. An empty list accepts the options.
   */
  readonly validate?: (options: Options) => readonly GwenConfigIssue[];

  /** Runtime plugin declaration. Resolved options are attached at setup. */
  readonly plugin: {
    /** Package or file that exports the plugin factory. */
    readonly src: string;
    /** Named export of the plugin factory. */
    readonly export: string;
  };

  /**
   * Builds the Vite plugin from the resolved options.
   *
   * @param options - Resolved options.
   * @returns Vite plugin fields copied into the kit.
   */
  readonly vitePlugin: (options: Readonly<Options>) => VitePlugin;

  /** Auto-imports copied into the kit at setup, in this order. */
  readonly autoImports: readonly AutoImport[];
}

/**
 * Builds a GWEN module that registers one physics plugin.
 *
 * An empty `name` throws `GwenModuleDefinitionError` with code `KIT:MODULE_INVALID`.
 *
 * @template Options - Options stored under `configKey`.
 * @param definition - Name, defaults, plugin declaration and Vite plugin.
 * @returns The module `defineGwenModule` validated.
 */
export function definePhysicsModule<Options extends object = Record<string, unknown>>(
  definition: PhysicsModuleDefinition<Options>,
): GwenModule<Options> {
  const { name, configKey, defaults, validate, plugin, vitePlugin, autoImports } = definition;
  const moduleDefinition: GwenModule<Options> = {
    meta: { name, configKey },
    defaults,
    setup(options, kit) {
      kit.addPlugin({ ...plugin, options });
      kit.addAutoImports([...autoImports]);
      kit.addVitePlugin({ ...vitePlugin(options) });
    },
  };
  if (validate !== undefined) moduleDefinition.validate = validate;
  return defineGwenModule(moduleDefinition);
}
