import { onEnter } from "other-lib";
import { onEnter as real } from "@gwenjs/core/scene";

onEnter(async () => {
  await skipped();
});

real(async () => {
  await load(/*@map*/ mark);
});
