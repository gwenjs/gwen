import { defineSystem, onUpdate, useQuery, useService } from "@gwenjs/core/system";

export const Setup = defineSystem("Setup", () => {
  const audio = useService("audio");
  const movers = useQuery([]);
  onUpdate(() => {
    audio.play(movers);
  });
});

export const Anchor = defineSystem("Anchor", () => {
  onUpdate(() => {
    useService("anchor");
  });
});
