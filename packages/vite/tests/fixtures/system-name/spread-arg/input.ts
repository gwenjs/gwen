import { defineSystem } from "@gwenjs/core/system";

export const args = [() => 1];

export const Spread = defineSystem(...args);

export const Anchor = defineSystem((/*@map*/ anchorMark) => anchorMark);
