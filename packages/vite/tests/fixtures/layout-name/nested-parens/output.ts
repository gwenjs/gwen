import { defineLayout } from "@gwenjs/core/actor";

declare function wrap<T>(value: T): T;

export const Level1 = defineLayout(wrap(wrap(wrap(() => ({})))));
__GWEN_DEV__ && Object.assign(Level1, { __layoutName__: "Level1" });

export const kept = (/*@map*/ keptMark) => keptMark;
