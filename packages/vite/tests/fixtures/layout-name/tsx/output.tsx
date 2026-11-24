import { defineLayout } from "@gwenjs/core/actor";

export const Level1 = defineLayout(() => ({}));
__GWEN_DEV__ && Object.assign(Level1, { __layoutName__: "Level1" });

export const View = <span />;

export const kept = (/*@map*/ keptMark) => keptMark;
