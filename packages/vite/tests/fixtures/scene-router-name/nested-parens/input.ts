import { defineSceneRouter } from "@gwenjs/core/scene";

declare function wrap<T>(value: T): T;

export const AppRouter = defineSceneRouter(wrap(wrap(wrap({ initial: "menu", routes: {} }))));

export const kept = (/*@map*/ keptMark) => keptMark;
