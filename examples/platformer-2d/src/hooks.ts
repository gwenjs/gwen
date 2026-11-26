import { defineHooks } from "@gwenjs/core";
import type { InferHooks } from "@gwenjs/core";

export const GameHooks = defineHooks({
  "game:start": (): void => undefined,
  "game:coin-collected": (_payload: { total: number }): void => undefined,
});

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks extends InferHooks<typeof GameHooks> {}
}
