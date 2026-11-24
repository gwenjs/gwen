import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onExit } from "@gwenjs/core/scene";

onExit(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>save(/*@map*/ mark))),await __temp,__restore());
});
