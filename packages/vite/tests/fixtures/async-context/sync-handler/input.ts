import { onEnter } from "@gwenjs/core/scene";

onEnter(() => {
  const value = 1;
  return value;
});

onEnter(async () => {
  await load(/*@map*/ mark);
});
