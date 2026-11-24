import { defineSceneRouter } from "@gwenjs/core/scene";

declare function wrap<T>(value: T): T;

export const AppRouter = defineSceneRouter(wrap(wrap(wrap({ initial: "menu", routes: {} }))));
__GWEN_DEV__ && Object.assign(AppRouter, { __routerName__: "AppRouter" });

export const kept = (/*@map*/ keptMark) => keptMark;
