import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  const v = await { a: 1, /*@map*/ mark };
  void v;
});
