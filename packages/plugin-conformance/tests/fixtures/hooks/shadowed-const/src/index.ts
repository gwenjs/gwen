import { emit } from "@gwenjs/core";

export const B = "engine:tick";

export function relay(B: string): void {
  emit(B);
}
