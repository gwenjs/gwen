import { defineSceneRouter } from "other-lib";
import { defineSceneRouter as real } from "@gwenjs/core/scene";

export const Hidden = defineSceneRouter({ initial: "menu", routes: {} });

export const Anchor = real({ initial: "menu", routes: {} });

export const kept = (/*@map*/ keptMark) => keptMark;
