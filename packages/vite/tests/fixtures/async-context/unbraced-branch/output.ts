import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "@gwenjs/core/scene";

onEnter(async () => { let __temp, __restore;
  if (a) (([__temp,__restore]=__executeAsync(()=>f())),__temp=await __temp,__restore(),__temp);
  else (([__temp,__restore]=__executeAsync(()=>g(/*@map*/ mark))),__temp=await __temp,__restore(),__temp);
});
