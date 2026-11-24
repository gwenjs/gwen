import { defineSceneRouter } from "@gwenjs/core/scene";

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });
__GWEN_DEV__ && Object.assign(AppRouter, { __routerName__: "AppRouter" });

export function build() {
  const Inner = defineSceneRouter({ initial: "menu", routes: {} });
  __GWEN_DEV__ && Object.assign(Inner, { __routerName__: "Inner" });
  return Inner;
}

export const kept = (/*@map*/ keptMark) => keptMark;
