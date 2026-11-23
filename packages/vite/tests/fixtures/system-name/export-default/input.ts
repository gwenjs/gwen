import { defineSystem } from "@gwenjs/core/system";

export default defineSystem(() => 1);

export const Anchor = defineSystem((/*@map*/ anchorMark) => anchorMark);
