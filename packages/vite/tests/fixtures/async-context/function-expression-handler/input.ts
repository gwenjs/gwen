import { onEnter } from "@gwenjs/core/scene";

onEnter(async function () {
  await load(/*@map*/ mark);
});
