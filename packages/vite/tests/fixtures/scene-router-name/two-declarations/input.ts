import { defineSceneRouter } from "@gwenjs/core/scene";

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });

export function build() {
  const Inner = defineSceneRouter({ initial: "menu", routes: {} });
  return Inner;
}

export const kept = (/*@map*/ keptMark) => keptMark;
