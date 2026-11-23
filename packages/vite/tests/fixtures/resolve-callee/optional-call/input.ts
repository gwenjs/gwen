import { defineSystem as ds } from "@gwenjs/core/system";
import * as G from "@gwenjs/core/system";

export const direct = ds?.(1);
export const chain = G?.defineSystem(1);
export const call = G.defineSystem?.(1);
