import { defineSceneRouter } from "@gwenjs/core/scene";

export const text = 'const Hidden = defineSceneRouter({ initial: "menu", routes: {} })';

export const Anchor = defineSceneRouter({ initial: "menu", routes: {} });
__GWEN_DEV__ && Object.assign(Anchor, { __routerName__: "Anchor" });

export const kept = (/*@map*/ keptMark) => keptMark;
