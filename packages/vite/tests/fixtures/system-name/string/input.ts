import { defineSystem } from "@gwenjs/core/system";

export const text = "const A = defineSystem(() => {})";

export const Anchor = defineSystem((/*@map*/ anchorMark) => anchorMark);
