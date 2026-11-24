import { defineSceneRouter } from "./barrel";

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });

export const kept = (/*@map*/ keptMark) => keptMark;
