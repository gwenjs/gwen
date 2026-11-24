import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onEnter } from "@gwenjs/core/scene";

export function inner(value: number) {
  const onEnter = (fn: () => Promise<void>) => fn();
  onEnter(async () => {
    await skipped();
  });
  return value;
}

onEnter(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
