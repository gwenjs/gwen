import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { defineLayers } from "@gwenjs/physics2d";
import { onEnter } from "@gwenjs/core/scene";

export const layers = defineLayers;


onEnter(async () => { let __temp, __restore;
  const value = (([__temp,__restore]=__executeAsync(()=>load(4 + /*@map*/ mark))),__temp=await __temp,__restore(),__temp);
  ;(([__temp,__restore]=__executeAsync(()=>next())),await __temp,__restore());
  report(value);
});
