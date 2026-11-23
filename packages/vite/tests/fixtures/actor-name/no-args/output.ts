import { defineActor } from "@gwenjs/core/actor";

export const Empty = defineActor("Empty");

export const kept = (/*@map*/ tailMark) => tailMark;
