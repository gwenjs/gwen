import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  const value = await load(/*@map*/ mark);
  await next();
  report(value);
});
