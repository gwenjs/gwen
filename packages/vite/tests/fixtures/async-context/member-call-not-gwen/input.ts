import { onEnter } from "@gwenjs/core/scene";

const router = {
  onEnter(_fn: unknown) {},
};

router.onEnter(async () => {
  await skipped();
});

onEnter(async () => {
  await load(/*@map*/ mark);
});
