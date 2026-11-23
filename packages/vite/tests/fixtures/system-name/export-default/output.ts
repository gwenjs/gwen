import { defineSystem } from "@gwenjs/core/system";

export default defineSystem(() => 1);

export const Anchor = defineSystem("Anchor", (/*@map*/ anchorMark) => anchorMark);
