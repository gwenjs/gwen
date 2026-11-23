import { defineSystem } from "@gwenjs/core/system";

export let loose = defineSystem(() => 1);
loose = defineSystem(() => 2);

export const Anchor = defineSystem((/*@map*/ anchorMark) => anchorMark);
