import type { GwenSourceTransform } from "./types.js";
import type { GwenOptimizerUserOptions } from "../types.js";
import { actorName } from "../transforms/actor-name.js";
import { asyncContext } from "../transforms/async-context.js";
import { hoistChunkColumns } from "../transforms/hoist-chunk-columns.js";
import { hotPathWarn } from "../transforms/hot-path-warn.js";
import { layoutName } from "../transforms/layout-name.js";
import { queryHoist } from "../transforms/query-hoist.js";
import { sceneRouterName } from "../transforms/scene-router-name.js";
import { systemName } from "../transforms/system-name.js";

/** Built-in units in application order. */
export const BUILT_IN_UNITS: GwenSourceTransform[] = [
  asyncContext,
  systemName,
  actorName,
  layoutName,
  sceneRouterName,
  queryHoist,
  hotPathWarn,
];

/** Units that run only with `optimizer` on, after every built-in unit. */
export const OPTIMIZER_UNITS: GwenSourceTransform[] = [hoistChunkColumns];

/** `true` or an options object turns the optimizer on. `false` and `undefined` leave it off. */
export function optimizerEnabled(option: boolean | GwenOptimizerUserOptions | undefined): boolean {
  return option !== undefined && option !== false;
}

/** Only an options object with `debug: true` logs the skipped loops. */
export function optimizerDebug(option: boolean | GwenOptimizerUserOptions | undefined): boolean {
  return typeof option === "object" && option.debug === true;
}
