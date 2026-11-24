import type { GwenEngine } from "@gwenjs/schema";
import { onEnter } from "@gwenjs/core/scene";

onEnter(async (p?: Record<string, unknown>): Promise<void> => {
  const engine: GwenEngine | undefined = undefined;
  void p;
  void engine;
  await load(/*@map*/ mark);
});
