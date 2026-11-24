import { defineSceneRouter } from "@gwenjs/core/scene";

function dec(value: unknown) {
  return value;
}

@dec
export class Box {}

export const AppRouter = defineSceneRouter({ initial: "menu", routes: {} });

export const kept = (/*@map*/ keptMark) => keptMark;
