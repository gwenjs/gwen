import { defineSystem } from "@gwenjs/core/system";

export const Named = defineSystem(`n`, () => 1);

export const Anchor = defineSystem("Anchor", (/*@map*/ anchorMark) => anchorMark);
