import { onEnter } from "@gwenjs/core/scene";

// onEnter(async () => { await skipped(); });

onEnter(async () => {
  await load(/*@map*/ mark);
});
