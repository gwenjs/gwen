import { useActor } from "@gwenjs/core/actor";
import { defineScene, onEnter } from "@gwenjs/core/scene";
import { Crate } from "../actors/Crate";
import { Mover } from "../actors/Mover";

export const interpolation = defineScene("interpolation", () => {
  const mover = useActor(Mover);
  const crate = useActor(Crate);

  onEnter(() => {
    mover.spawnOnce();
    crate.spawnOnce();
  });
});
