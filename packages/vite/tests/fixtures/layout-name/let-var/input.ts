import { defineLayout } from "@gwenjs/core/actor";

let Hidden = defineLayout(() => ({}));
let Other = defineLayout(() => ({}));
Hidden = defineLayout(() => ({}));
Other = defineLayout(() => ({}));
export const seen = Hidden ?? Other;

export const Anchor = defineLayout(() => ({}));

export const kept = (/*@map*/ keptMark) => keptMark;
