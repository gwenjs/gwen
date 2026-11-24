/**
 * @file gwen:physics2d — registers `gwen:layer-inline` on the transform pipeline.
 *
 * Registered automatically via physics2d module.ts.
 * A manual Vite config must place `gwen()` from `@gwenjs/vite` before this plugin.
 */

import type { Plugin } from "vite";
import { GwenError } from "@gwenjs/schema";
import { layerInlineTransform } from "@gwenjs/vite/shared/layer-utils";
import { Physics2DErrorCodes } from "./errors";

/** Options for {@link physics2dVitePlugin}. Layer inlining takes none. */
export type Physics2DVitePluginOptions = Record<never, never>;

function isLayerRegister(value: unknown): value is (unit: typeof layerInlineTransform) => void {
  return typeof value === "function";
}

function pipelineApi(
  plugins: readonly Plugin[],
): { register: (unit: typeof layerInlineTransform) => void } | undefined {
  for (const plugin of plugins) {
    if (plugin.name !== "gwen:transform-pipeline") continue;
    const candidate: unknown = plugin.api;
    if (typeof candidate !== "object" || candidate === null || !("register" in candidate)) {
      return undefined;
    }
    const register: unknown = candidate.register;
    if (!isLayerRegister(register)) return undefined;
    return { register };
  }
  return undefined;
}

/**
 * `gwen:physics2d` — Vite plugin that registers layer inlining on the pipeline.
 *
 * @param _options - Kept so {@link Physics2DVitePluginOptions} stays on the signature.
 * @returns A Vite {@link Plugin}.
 *
 * @example
 * ```ts
 * // Registered automatically by physics2d module.ts.
 * // Manual setup: gwen() from @gwenjs/vite, then physics2dVitePlugin().
 * ```
 *
 * @since 1.0.0
 */
export function physics2dVitePlugin(_options: Physics2DVitePluginOptions = {}): Plugin {
  return {
    name: "gwen:physics2d",
    configResolved(config) {
      const api = pipelineApi(config.plugins);
      if (api === undefined) {
        throw new GwenError(
          Physics2DErrorCodes.VITE_PIPELINE_MISSING,
          "gwen:transform-pipeline is not in the Vite config.",
          {
            composable: "physics2dVitePlugin",
            hint:
              process.env["NODE_ENV"] !== "production"
                ? "Add gwen() from @gwenjs/vite before the physics plugin."
                : undefined,
          },
        );
      }
      api.register(layerInlineTransform);
    },
  };
}
