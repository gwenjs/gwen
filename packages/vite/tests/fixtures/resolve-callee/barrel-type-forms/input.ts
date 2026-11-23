import { defineSystem } from "./barrel";
import { defineActor } from "./barrel";
import { defineScene } from "./barrel";
import { defineSceneRouter } from "./barrel";

export const system = defineSystem(1);
export const actor = defineActor(1);
export const scene = defineScene(1);
export const router = defineSceneRouter(1);
