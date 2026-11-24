import { defineSceneRouter } from "@gwenjs/core/scene";

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });

export const View = <span />;

export const kept = (/*@map*/ keptMark) => keptMark;
