import type { GwenSourceTransform } from "./types.js";
import { systemName } from "../transforms/system-name.js";

/** Built-in units in application order. */
export const BUILT_IN_UNITS: GwenSourceTransform[] = [systemName];
