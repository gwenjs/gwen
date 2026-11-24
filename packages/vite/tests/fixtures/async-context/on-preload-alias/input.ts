import { onPreload as preload } from "@gwenjs/core/scene";

preload(async () => {
  await load(/*@map*/ mark);
});
