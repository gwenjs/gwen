import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onPreload as preload } from "@gwenjs/core/scene";

preload(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
