import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "./barrel";

onEnter(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
