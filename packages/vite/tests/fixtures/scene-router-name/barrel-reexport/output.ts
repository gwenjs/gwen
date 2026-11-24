import { defineSceneRouter } from "./barrel";

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });
__GWEN_DEV__ && Object.assign(AppRouter, { __routerName__: "AppRouter" });

export const kept = (/*@map*/ keptMark) => keptMark;
