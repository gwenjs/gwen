import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  const inner = async () => {
    await skipped();
  };
  void inner;
  await load(/*@map*/ mark);
});
