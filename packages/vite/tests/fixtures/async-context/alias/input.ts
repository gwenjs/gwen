import { onEnter as enter } from "@gwenjs/core/scene";

enter(async () => {
  await load(/*@map*/ mark);
});
