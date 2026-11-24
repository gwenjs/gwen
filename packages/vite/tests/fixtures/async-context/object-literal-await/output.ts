import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => { let __temp, __restore;
  const v = (([__temp,__restore]=__executeAsync(()=>({ a: 1, /*@map*/ mark }))),__temp=await __temp,__restore(),__temp);
  void v;
});
