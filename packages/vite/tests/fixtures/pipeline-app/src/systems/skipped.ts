import { defineSystem, onUpdate, useQuery } from "@gwenjs/core/system";
import { Position } from "../components";

export const Skipped = defineSystem("Skipped", () => {
  const q = useQuery([Position]);
  onUpdate(() => {
    for (const chunk of q) {
      for (let i = 0; i < chunk.count; i++) {
        track(chunk.get(Position).x[i]);
      }
    }
  });
});

declare function track(value: number): void;
