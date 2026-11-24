import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "other-lib";
import { onEnter as real } from "@gwenjs/core/scene";

onEnter(async () => {
  await skipped();
});

real(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
