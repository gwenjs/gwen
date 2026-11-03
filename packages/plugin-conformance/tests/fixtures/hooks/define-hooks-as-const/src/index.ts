import { defineHooks, emit } from "@gwenjs/core";

export const first = defineHooks({ "myplug:a": () => {} } as const);

export const second = defineHooks({ "myplug:b": () => {} } satisfies Record<string, () => void>);

export function announce(): void {
  emit("myplug:a");
  emit("myplug:b");
}
