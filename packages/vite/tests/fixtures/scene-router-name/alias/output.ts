import { defineSceneRouter as make } from "@gwenjs/core/scene";

export const AppRouter = make({ initial: "menu", routes: {} });
__GWEN_DEV__ && Object.assign(AppRouter, { __routerName__: "AppRouter" });

export const kept = (/*@map*/ keptMark) => keptMark;
