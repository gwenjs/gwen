import { defineSceneRouter } from "@gwenjs/core/scene";

function dec(value: unknown) {
  return value;
}

@dec
export class Box {}

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });
__GWEN_DEV__ && Object.assign(AppRouter, { __routerName__: "AppRouter" });

export const kept = (/*@map*/ keptMark) => keptMark;
