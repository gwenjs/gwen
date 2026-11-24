import { defineSceneRouter } from "@gwenjs/core/scene";

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });
__GWEN_DEV__ && Object.assign(AppRouter, { __routerName__: "AppRouter" });

export const View = <span />;

export const kept = (/*@map*/ keptMark) => keptMark;
