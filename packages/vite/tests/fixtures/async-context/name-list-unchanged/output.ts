import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import { onUpdate } from "@gwenjs/core/system";
import { onEnter, onTransitionEnter, onTransitionExit } from "@gwenjs/core/scene";

onUpdate(async () => {
  await frame();
});

onTransitionExit(async () => {
  await leave();
});

onTransitionEnter(async () => {
  await enterScene();
});

onEnter(async () => { let __temp, __restore;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
