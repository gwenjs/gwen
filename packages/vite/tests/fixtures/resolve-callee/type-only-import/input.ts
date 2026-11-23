import type { defineSystem } from "@gwenjs/core/system";
import { type defineActor } from "@gwenjs/core/actor";

export const system: defineSystem = defineSystem(() => 1);
export const actor: defineActor = defineActor(() => 1);
import * as G from "@gwenjs/core/system";
export const Anchor = G.defineSystem(() => 1);
