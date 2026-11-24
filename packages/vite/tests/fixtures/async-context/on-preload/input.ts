import { onPreload } from "@gwenjs/core/scene";

onPreload(async (event) => {
  await load(/*@map*/ mark);
  event.progress("a", 1, 1);
});
