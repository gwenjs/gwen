import { onEnter } from "./barrel";

onEnter(async () => {
  await load(/*@map*/ mark);
});
