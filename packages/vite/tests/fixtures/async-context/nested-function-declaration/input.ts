import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => {
  async function inner() {
    await skipped();
  }
  class Box {
    async method() {
      await skipped();
    }
  }
  void inner;
  void Box;
  await load(/*@map*/ mark);
});
