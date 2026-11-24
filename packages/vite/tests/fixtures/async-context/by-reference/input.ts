import { onEnter } from "@gwenjs/core/scene";

const handler = async () => {
  await skipped();
};

onEnter(handler);

onEnter(async () => {
  await load(/*@map*/ mark);
});
