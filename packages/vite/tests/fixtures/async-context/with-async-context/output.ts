import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { withAsyncContext } from "@gwenjs/core";

withAsyncContext(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>work(/*@map*/ mark))),await __temp,__restore());
});
