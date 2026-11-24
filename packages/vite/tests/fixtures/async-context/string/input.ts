import { onEnter } from "@gwenjs/core/scene";

export const text = "onEnter(async () => { await skipped(); })";

onEnter(async () => {
  await load(/*@map*/ mark);
});
