import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  if (a) await f();
  else await g(/*@map*/ mark);
});
