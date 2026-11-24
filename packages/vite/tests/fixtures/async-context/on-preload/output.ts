import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onPreload } from "@gwenjs/core/scene";

onPreload(async (event) => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
  event.progress("a", 1, 1);
});
