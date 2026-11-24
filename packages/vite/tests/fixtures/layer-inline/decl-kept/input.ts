import { defineLayers } from "@gwenjs/physics2d";

const L = defineLayers({ anchor: 1, k: 2 });
export function take(value: unknown) {
  return value;
}
export const passed = take(L);
export const value = L.anchor + L.k + /*@map*/ kept;
