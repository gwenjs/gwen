import { defineActor, definePrefab } from "@gwenjs/core/actor";
import { Position } from "../components/Position";
import { Velocity } from "../components/Velocity";

export const Drifter = defineActor(
  definePrefab([
    { def: Position, defaults: { x: 0, y: 0 } },
    { def: Velocity, defaults: { x: 1, y: 0 } },
  ]),
  () => undefined,
);
