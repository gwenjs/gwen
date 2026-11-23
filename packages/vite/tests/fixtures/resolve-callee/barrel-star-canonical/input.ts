import { defineSceneRouter } from "./gwen";
import * as G from "@gwenjs/core/system";

export const run = defineSceneRouter(1);
export const Anchor = G.defineSystem(() => 1);
