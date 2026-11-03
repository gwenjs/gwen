import { emit } from "@gwenjs/core";

export function announce(kind: string, suffix: string): void {
  emit(`myplug:${kind}`);
  emit(suffix);
}
