import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "@gwenjs/core/scene";

onEnter(() => {
  const value = 1;
  return value;
});

onEnter(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
