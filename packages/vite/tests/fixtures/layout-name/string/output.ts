import { defineLayout } from "@gwenjs/core/actor";

export const text = "const Hidden = defineLayout(() => ({}))";

export const Anchor = defineLayout(() => ({}));
__GWEN_DEV__ && Object.assign(Anchor, { __layoutName__: "Anchor" });

export const kept = (/*@map*/ keptMark) => keptMark;
