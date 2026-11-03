import { emit } from "@gwenjs/core";

export function activate(): void {
  emit("camera:activate");
}
