import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  await load(/*@map*/ mark);
});
