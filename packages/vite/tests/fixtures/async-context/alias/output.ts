import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter as enter } from "@gwenjs/core/scene";

enter(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
