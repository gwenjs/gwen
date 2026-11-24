import { defineLayout } from "other-lib";
import { defineLayout as real } from "@gwenjs/core/actor";

export const Hidden = defineLayout(() => ({}));

export const Anchor = real(() => ({}));
__GWEN_DEV__ && Object.assign(Anchor, { __layoutName__: "Anchor" });

export const kept = (/*@map*/ keptMark) => keptMark;
