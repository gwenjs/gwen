import { emit } from "@gwenjs/core";

declare module "@gwenjs/schema" {
  interface GwenRuntimeHooks {
    "myplug:ready": () => void;
  }
}

export function announce(): void {
  emit("myplug:ready");
}
