import { defineHooks } from "@gwenjs/core";

export const hooks = defineHooks({
  ready: () => {},
});

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    started: () => void;
  }
}
