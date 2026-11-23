import { defineActor } from "@gwenjs/core/actor";

export const Empty = defineActor();

export const kept = (/*@map*/ tailMark) => tailMark;
