import { defineSystem } from "@gwenjs/core/system";

export const Named = defineSystem("A", () => 1);

export const Anchor = defineSystem("Anchor", (/*@map*/ anchorMark) => anchorMark);
