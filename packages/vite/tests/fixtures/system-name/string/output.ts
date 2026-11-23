import { defineSystem } from "@gwenjs/core/system";

export const text = "const A = defineSystem(() => {})";

export const Anchor = defineSystem("Anchor", (/*@map*/ anchorMark) => anchorMark);
