import { defineSceneRouter as make } from "@gwenjs/core/scene";

export const AppRouter = make({ initial: "menu", routes: {} });

export const kept = (/*@map*/ keptMark) => keptMark;
