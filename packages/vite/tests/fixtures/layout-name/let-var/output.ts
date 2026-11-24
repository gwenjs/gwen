import { defineLayout } from "@gwenjs/core/actor";

let Hidden = defineLayout(() => ({}));
let Other = defineLayout(() => ({}));
Hidden = defineLayout(() => ({}));
Other = defineLayout(() => ({}));
export const seen = Hidden ?? Other;

export const Anchor = defineLayout(() => ({}));
__GWEN_DEV__ && Object.assign(Anchor, { __layoutName__: "Anchor" });

export const kept = (/*@map*/ keptMark) => keptMark;
