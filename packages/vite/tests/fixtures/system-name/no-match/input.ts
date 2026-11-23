import { defineSystem } from "other-lib";
import { defineSystem as real } from "@gwenjs/core/system";

export const Foreign = defineSystem(() => 1);

export const Anchor = real((/*@map*/ anchorMark) => anchorMark);
