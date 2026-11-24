import { defineLayout } from "@gwenjs/core/actor";

declare function wrap<T>(value: T): T;

export const Level1 = defineLayout(wrap(wrap(wrap(() => ({})))));

export const kept = (/*@map*/ keptMark) => keptMark;
