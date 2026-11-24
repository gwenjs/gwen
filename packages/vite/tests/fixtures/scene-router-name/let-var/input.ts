import { defineSceneRouter } from "@gwenjs/core/scene";

let Hidden = defineSceneRouter({ initial: "menu", routes: {} });
let Other = defineSceneRouter({ initial: "menu", routes: {} });
Hidden = defineSceneRouter({ initial: "menu", routes: {} });
Other = defineSceneRouter({ initial: "menu", routes: {} });
export const seen = Hidden ?? Other;

export const Anchor = defineSceneRouter({ initial: "menu", routes: {} });

export const kept = (/*@map*/ keptMark) => keptMark;
