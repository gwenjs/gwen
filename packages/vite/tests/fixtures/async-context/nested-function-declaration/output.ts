import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => { let __temp, __restore;
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
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
