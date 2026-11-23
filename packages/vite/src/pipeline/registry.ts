import type { GwenSourceTransform } from "./types.js";
import { actorName } from "../transforms/actor-name.js";
import { systemName } from "../transforms/system-name.js";

/** Built-in units in application order. */
export const BUILT_IN_UNITS: GwenSourceTransform[] = [systemName, actorName];
