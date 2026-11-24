import { defineLayout } from "other-lib";
import { defineLayout as real } from "@gwenjs/core/actor";

export const Hidden = defineLayout(() => ({}));

export const Anchor = real(() => ({}));

export const kept = (/*@map*/ keptMark) => keptMark;
