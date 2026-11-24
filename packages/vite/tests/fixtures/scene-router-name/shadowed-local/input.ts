import { defineSceneRouter } from "@gwenjs/core/scene";

export function inner(value: number) {
  const defineSceneRouter = (count: number) => count;
  const Hidden = defineSceneRouter(value);
  return Hidden;
}

export const Anchor = defineSceneRouter({ initial: "menu", routes: {} });

export const kept = (/*@map*/ keptMark) => keptMark;
