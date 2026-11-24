import { executeAsync as __executeAsync } from "@gwenjs/core/internal";
import type { GwenEngine } from "@gwenjs/schema";
import { onEnter } from "@gwenjs/core/scene";

onEnter(async (p?: Record<string, unknown>): Promise<void> => { let __temp, __restore;
  const engine: GwenEngine | undefined = undefined;
  void p;
  void engine;
  ;(([__temp,__restore]=__executeAsync(()=>load(/*@map*/ mark))),await __temp,__restore());
});
