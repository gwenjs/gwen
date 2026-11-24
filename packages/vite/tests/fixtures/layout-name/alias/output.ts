import { defineLayout as make } from "@gwenjs/core/actor";

export const Level1 = make(() => ({}));
__GWEN_DEV__ && Object.assign(Level1, { __layoutName__: "Level1" });

export const kept = (/*@map*/ keptMark) => keptMark;
