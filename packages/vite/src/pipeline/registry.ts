import type { GwenSourceTransform } from "./types.js";
import { actorName } from "../transforms/actor-name.js";
import { asyncContext } from "../transforms/async-context.js";
import { queryHoist } from "../transforms/query-hoist.js";
import { systemName } from "../transforms/system-name.js";

/** Built-in units in application order. */
export const BUILT_IN_UNITS: GwenSourceTransform[] = [
  asyncContext,
  systemName,
  actorName,
  queryHoist,
];
